'use strict';

import './styles/hljs.css';
import './styles/main.css';

import Vue from 'vue/dist/vue.min';

import TestWorker from './tester.worker.js';
import { getCurrentUrl, request, downloadURI } from './utils.js';

// todo: dist obfuscation
// todo: webpack add build datetime const

// todo: console.log to html (stdout block in html)
// todo: simple eval execution (to learn and debug) with console.log to html (code.replace('console.log', 'htmlLog'));

// todo: drag&drop decoration

// GLOBAL VARS
let userCode;
let checkingInProgress = false;
let testWorker = createTestWorker();
const EventBus = new Vue();

let versionInfo = document.getElementById('versionInfo');
let dragLine = document.getElementById('dragLine');
//let taskBlock = document.getElementById('taskBlock');
//let editorBlock = document.getElementById('editorBlock');

versionInfo.innerHTML = 'v. ' + VERSION;

function resetAfterCheck() {
    checkingInProgress = false;
    terminateButton.style.display = 'none';
    checkButton.style.display = 'inline-block';
}

function createTestWorker() {
    let testWorker = new TestWorker();
    testWorker.addEventListener('message', executorMessage);
    return testWorker;
}

function slidingInit() {
    function applySlide(leftPercentage) {
        if (leftPercentage <= 2) { // due to padding can't hide if only width is 0
            taskBlock.style.display = 'none';
            editorBlock.style.width = '100%';
            dragLine.style.width = '50px';
        } else if (leftPercentage >= 98) {
            taskBlock.style.width = '100%';
            editorBlock.style.display = 'none';
            dragLine.style.width = '50px';
        } else {
            taskBlock.style.display = 'block';
            taskBlock.style.width = leftPercentage + '%';
            dragLine.style.width = null;

            editorBlock.style.display = 'block';
            editorBlock.style.width = (100 - leftPercentage) + '%';
        }
    }
    applySlide(window.localStorage.getItem('leftPercentage') || 30);

    let dragLineSlide = false;
    let bodyEl = document.querySelector('body');

    function startSlide() {
        dragLineSlide = true;
        bodyEl.style.userSelect = 'none';
        bodyEl.style.cursor = 'pointer';
    }
    function endSlide() {
        if (dragLineSlide) {
            dragLineSlide = false;
            bodyEl.style.userSelect = 'auto';
            bodyEl.style.cursor = 'inherit';

            let leftPercentage = 0;
            if (editorBlock.style.display === 'none') {
                leftPercentage = 100;
            } else if (taskBlock.style.display !== 'none') {
                leftPercentage = taskBlock.style.width.slice(0, taskBlock.style.width.length - 1);
            }

            window.localStorage.setItem('leftPercentage', leftPercentage);
        }
    }
    function slideEvent(e) {
        if (dragLineSlide) {
            let percPos = Math.round(e.pageX / window.innerWidth * 100);
            applySlide(percPos);
        }
    }

    dragLine.addEventListener('mousedown', startSlide);
    dragLine.addEventListener('touchstart', startSlide);
    window.addEventListener('mouseup', endSlide);
    window.addEventListener('touchend', endSlide);
    window.addEventListener('mousemove', slideEvent);
    window.addEventListener('touchmove', slideEvent);
}
slidingInit();

let checkApp = new Vue({
    el: '#checkArea',
    delimiters: ['{{', '}}'],
    data: {
        amount: 0,

        // describes if test passed or not, and if not - specifies and error
        // format: {passed: null|true|false, errorText: ''}
        testsInfo: [
        ],

        // string that stores the code which was tested (result is this.testsInfo)
        checkedCode: null,

        ms: {
            total: 0,
            max: null,
            average: 0,
            min: null
        },
        s: {
            total: '-',
            max: '-',
            average: '-',
            min: '-'
        }
    },
    methods: {
        resetTestsInfo(len = 0) {
            this.testsInfo = [];
            for (let i = 0; i < len; i++) {
                this.testsInfo.push({passed: null, errorText: null})
            }
        },
        resetAll: function () {
            this.amount = 0;
            
            this.ms.total = 0;
            this.ms.max = null;
            this.ms.average = 0;
            this.ms.min = null;
            
            this.s.total = '-';
            this.s.max = '-';
            this.s.average = '-';
            this.s.min = '-';

            this.resetTestsInfo(this.testsInfo.length);
        },
        updateSeconds: function () {
            this.s.total = (this.ms.total / 1000).toFixed(3);
            this.s.max = (this.ms.max / 1000).toFixed(3);
            this.s.average = (this.ms.average / 1000).toFixed(3);
            this.s.min = (this.ms.min / 1000).toFixed(3);
        },
        addTime: function (time) {
            this.amount += 1;

            this.ms.total += time;
            this.ms.average = this.ms.total / this.amount;
            if (time > this.ms.max || this.ms.max === null) {
                this.ms.max = time;
            }
            if (time < this.ms.min || this.ms.min === null) {
                this.ms.min = time;
            }

            this.updateSeconds();

            return (time / 1000).toFixed(3);
        },

        getTestInfoClass: function (test) {
            return (test.passed !== null)? ((test.passed)? 'success': 'error'): '';
        }
    },
    watch: {
        checkedCode: function(newCode) {
            this.$refs.sourceCode.innerHTML = newCode;
            hljs.highlightBlock(this.$refs.sourceCode);
            hljs.lineNumbersBlock(this.$refs.sourceCode);
        }
    },
    mounted: function () {
        let self = this;
        EventBus.$on('testsAmount', function (amount) {
            self.resetTestsInfo(amount);
        });
    }
});

let taskApp = new Vue({
    el: '#taskBlock',
    data: {
        name: null,
        description: null,
        tests: [],

        tasksList: null,
        selectedTaskName: null
    },
    methods: {
        load: function (name) {
            let self = this;
            let taskUrl = getCurrentUrl() + '/tasks/' + name;
            request('GET', taskUrl, function (status, data) {
                let task = JSON.parse(data);
                self.name = task.name;
                self.description = task.description;
                self.tests = task.tests;

                EventBus.$emit('taskChanged', self.selectedTaskName, self.tests[0][0], self.tests[0][1]);
                EventBus.$emit('testsAmount', self.tests.length);
            });
        },
        taskSelected: function () {
            this.load(this.selectedTaskName);
            window.localStorage.setItem('currentTaskName', this.selectedTaskName);
        }
    },
    mounted: function () {
        let taskListUrl = getCurrentUrl() + '/tasks/list.json';
        let self = this;
        request('GET', taskListUrl, function (status, data) {
            self.tasksList = JSON.parse(data);
            let savedTaskName = window.localStorage.getItem('currentTaskName');
            if (self.tasksList.includes(savedTaskName)) {
                self.selectedTaskName = savedTaskName;
            } else {
                self.selectedTaskName = self.tasksList[0];
            }
            self.taskSelected();
        });
    }
});

let editorApp = new Vue({
    el: '#editorBlock',
    data: {
        aceEditor: null,

        currentTaskName: null
    },
    methods: {
        saveToLocalStorage: function () {
            if (this.currentTaskName) {
                localStorage.setItem(this.currentTaskName, this.aceEditor.getValue());
                return true;
            } else {
                return false;
            }
        },
        loadFromLocalStorage: function (args, ret) {
            if (this.currentTaskName) {
                let code = localStorage.getItem(this.currentTaskName);

                if (code === null || code === '') {
                    code = '';

                    code += '/**\n';
                    for (let arg of args) {
                        code += ` * @param {${typeof (arg)}}\n`;
                    }
                    if (ret !== null) {
                        code += ` * @returns {${typeof (ret)}}\n`;
                    }
                    code += ' */\n';
                }

                this.aceEditor.setValue(code);
                this.aceEditor.execCommand("gotolineend");
                this.aceEditor.focus();
            }
        },
        downloadCode: function (save = true) {
            if (save) {
                this.saveToLocalStorage();
            }
            let editorCode = this.aceEditor.getValue();
            let encodedCode = encodeURIComponent(editorCode);
            let downloadName = this.currentTaskName.split('.')[0];
            downloadURI(`data:application/javascript,${encodedCode}`, downloadName + '.js');
        },
        setText: function (s) {
            this.aceEditor.setValue(s);
            this.aceEditor.execCommand("gotolineend");
        }
    },
    mounted: function () {
        this.aceEditor = ace.edit('editorBlock');
        this.aceEditor.setOptions({
            fontSize: '12pt',
        });

        //editor.setTheme('ace/theme/dawn');
        this.aceEditor.session.setMode('ace/mode/javascript');

        EventBus.$on('taskChanged', (name, args, ret) => {
            if (this.currentTaskName) {
                // saving only if there's a task opened, otherwise at first load will save empty
                this.saveToLocalStorage();
            }
            this.currentTaskName = name;
            this.loadFromLocalStorage(args, ret);
        });
    }
});

function checkDecision(editor) {
    userCode = editor.getValue();

    checkingInProgress = true;
    terminateButton.style.display = 'inline-block';
    checkButton.style.display = 'none';

    editorApp.saveToLocalStorage();

    checkApp.resetAll();

    testWorker.postMessage({
        tests: taskApp.tests,
        code: userCode
    });

    checkApp.checkedCode = userCode;
}
function executorMessage(e) {
    let testInfo = checkApp.testsInfo[e.data.testIndex];
    checkApp.addTime(e.data.time);
    
    if (e.data.passed) {
        testInfo.passed = true;
        
        let executedTestsAmount = e.data.testIndex + 1;
        if (executedTestsAmount === taskApp.tests.length) {
            resetAfterCheck();
        }
    } else {
        testInfo.passed = false;
        testInfo.errorText = e.data.errorText;
        
        resetAfterCheck();
    }
}

function terminateExecutor() {
    testWorker.terminate();
    testWorker = createTestWorker();

    resetAfterCheck();
}

function selectAndOpenFile() {
   let fInput = document.createElement('input');
   fInput.type = 'file';
   fInput.click();

   fInput.addEventListener('change', function (e) {
       if (e.target.files) {
           e.target.files[0].text().then(function (s) {
               editorApp.saveToLocalStorage();
               editorApp.setText(s);
           })
       }
   });
}

checkButton.addEventListener('click', function () {
    checkDecision(editorApp.aceEditor);
});
terminateButton.addEventListener('click', terminateExecutor);
saveButton.addEventListener('click', editorApp.downloadCode);
openButton.addEventListener('click', selectAndOpenFile);
window.addEventListener('keydown', function (e) {
    if (e.ctrlKey && e.code === 'F9' && checkingInProgress) {
        terminateExecutor();
    } else if (e.code === 'F9' && !checkingInProgress) {
        checkDecision(editorApp.aceEditor);
    } else if (e.ctrlKey && e.code === 'KeyS') {
        e.preventDefault();
        editorApp.downloadCode();
    }
});

mainBlock.addEventListener('drop', function (e) {
    e.preventDefault();

    if (e.dataTransfer.items && e.dataTransfer.items[0]) {
        let file = e.dataTransfer.items[0].getAsFile();
        file.text().then(function (s) {
            editorApp.setText(s);
        });
    }
});

// auto save code every minute
let autoSaveInterval = setInterval(() => { editorApp.saveToLocalStorage(); }, 60 * 1000);
window.addEventListener('beforeunload', (e) =>{
    editorApp.saveToLocalStorage();
});

// preventing default browser drag&drop behavior
mainBlock.addEventListener('dragover', function (e) {
   e.preventDefault();
});
