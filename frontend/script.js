const DEFAULT_CODE = `#include <stdio.h>
#include <unistd.h>
#include <signal.h>

void test_call_stack(int depth);

int main() {
    // 1. Test Line-by-Line Stepping & Variable Inspection
    int counter = 0;
    printf("[IDE TEST] Step through this loop to check variable updates.\\n");
    for (int i = 0; i < 3; i++) {
        counter += 10; // Set a breakpoint here. Does 'counter' update in your UI?
    }

    // 2. Test Call Stack / Backtrace Depth
    printf("\\n[IDE TEST] Entering deep function calls to test Stack Trace...\\n");
    test_call_stack(3);

    // 4. Test Crash / Signal Handling (Segmentation Fault)
    printf("\\n[IDE TEST] Triggering a crash to test SIGSEGV handling...\\n");
    int *bad_ptr = NULL;
    *bad_ptr = 999; // The IDE should catch this and show the exact line of the crash

    return 0;
}

void test_call_stack(int depth) {
    if (depth <= 0) {
        printf("  Reached maximum depth. Check your IDE's Call Stack panel now!\\n");
        return; // Set a breakpoint here to see main -> test_call_stack -> test_call_stack...
    }
    test_call_stack(depth - 1);
}
`;
const GDB_COMMAND_PREFIX = '__GDB_MI__:';
// to mark gdb command, continue, step...

let editor;
let terminal;
let fitAddon; //resize
let ws;
let files = { 'main.c': DEFAULT_CODE };
let currentFile = 'main.c';

document.body.classList.add('run-mode'); //default

function clamp(value, min, max) {return Math.min(Math.max(value, min), max);}
//limit in range

function applySavedPaneSizes() { 
    const savedSidebarWidth = localStorage.getItem('sidebarWidth');
    const savedRightPanelWidth = localStorage.getItem('rightPanelWidth');
    const savedDebuggerHeight = localStorage.getItem('debuggerHeight');
    if (savedSidebarWidth) document.documentElement.style.setProperty('--sidebar-width', savedSidebarWidth);
    if (savedRightPanelWidth) document.documentElement.style.setProperty('--right-panel-width', savedRightPanelWidth);
    if (savedDebuggerHeight) document.documentElement.style.setProperty('--debugger-height', savedDebuggerHeight);
}

function refreshResizableContent() {
    if (editor) editor.layout();
    if (fitAddon) fitAddon.fit();
}

function setupResizablePanes() {
    applySavedPaneSizes();
    const main = document.querySelector('main');
    const rightPanel = document.getElementById('right-panel');
    const sidebarResizer = document.getElementById('sidebar-resizer');
    const rightPanelResizer = document.getElementById('right-panel-resizer');
    const debuggerResizer = document.getElementById('debugger-resizer');
    function startDrag(resizer, mode, onMove, onEnd) {
        resizer.addEventListener('mousedown', (event) => {
            event.preventDefault();
            resizer.classList.add('dragging');
            document.body.classList.add('resizing', mode==='horizontal' ? 'resizing-horizontal' : 'resizing-vertical');
            const handleMove = (moveEvent) => {
                onMove(moveEvent);
                refreshResizableContent();
            };
            const handleUp = () => {
                resizer.classList.remove('dragging');
                document.body.classList.remove('resizing', 'resizing-horizontal', 'resizing-vertical');
                document.removeEventListener('mousemove', handleMove);
                document.removeEventListener('mouseup', handleUp);
                if (onEnd) onEnd();
                refreshResizableContent();
            };
            document.addEventListener('mousemove', handleMove);
            document.addEventListener('mouseup', handleUp);
        });
    }
    startDrag(sidebarResizer, 'vertical', (event) => {
        const mainRect = main.getBoundingClientRect();
        const width = clamp(event.clientX - mainRect.left, 140, mainRect.width * 0.45);
        const value = `${Math.round(width)}px`;
        document.documentElement.style.setProperty('--sidebar-width', value);
        localStorage.setItem('sidebarWidth', value);
    });
    startDrag(rightPanelResizer, 'vertical', (event) => {
        const mainRect = main.getBoundingClientRect();
        const width = clamp(mainRect.right - event.clientX, 260, mainRect.width * 0.7);
        const value = `${Math.round(width)}px`;
        document.documentElement.style.setProperty('--right-panel-width', value);
        localStorage.setItem('rightPanelWidth', value);
    });
    startDrag(debuggerResizer, 'horizontal', (event) => {
        const panelRect = rightPanel.getBoundingClientRect();
        const height = clamp(event.clientY - panelRect.top, 120, panelRect.height - 140);
        const value = `${Math.round(height)}px`;
        document.documentElement.style.setProperty('--debugger-height', value);
        localStorage.setItem('debuggerHeight', value);
    });
}
setupResizablePanes();

function setAppMode(mode) {
    document.body.classList.toggle('run-mode', mode === 'run');
    document.body.classList.toggle('debug-mode', mode === 'debug');
    refreshResizableContent();
}

function setupDebugSections() { // dong mo call stack,...
    document.querySelectorAll('.debug-section-header').forEach(header => {
        header.addEventListener('click', () => {
            header.closest('.debug-section').classList.toggle('collapsed');
        });
    });
}

function renderBreakpointTable() {
    const container = document.getElementById('breakpoints-list');
    if (!container) return;
    const breakpoints = window.getBreakpoints ? window.getBreakpoints() : [];
    container.innerHTML = '';
    if (breakpoints.length === 0) {
        container.className = 'debug-empty';
        container.textContent = 'No breakpoints set.';
        return;
    } // tao container moi
    container.className = '';
    const table = document.createElement('table');
    table.className = 'debug-table breakpoint-table';
    table.innerHTML = '<thead><tr><th>#</th><th>Description</th><th></th></tr></thead>';
    const tbody = document.createElement('tbody');
    breakpoints.forEach((line, index) => {
        const row = document.createElement('tr');
        const numberCell = document.createElement('td');
        numberCell.textContent = String(index + 1);
        const descriptionCell = document.createElement('td');
        descriptionCell.textContent = `in main at main.c:${line}`;
        const removeCell = document.createElement('td');
        removeCell.className = 'breakpoint-remove-cell';
        const removeButton = document.createElement('button');
        removeButton.type = 'button';
        removeButton.className = 'breakpoint-remove';
        removeButton.textContent = 'x';
        removeButton.addEventListener('click', () => window.removeBreakpoint && window.removeBreakpoint(line));
        removeCell.appendChild(removeButton);
        row.appendChild(numberCell);
        row.appendChild(descriptionCell);
        row.appendChild(removeCell);
        tbody.appendChild(row);
    });
    table.appendChild(tbody);
    container.appendChild(table);
}

setupDebugSections();
require.config({ paths: { 'vs': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs' }});
require(['vs/editor/editor.main'], function() {
    editor = monaco.editor.create(document.getElementById('editor-container'), {
        value: files[currentFile],
        language: 'c',
        theme: 'vs',
        automaticLayout: true,
        glyphMargin: true
    });
    const fileListEl = document.getElementById('file-list');
    const btnAddFile = document.getElementById('btn-add-file');
    function renderFileList() {
        fileListEl.innerHTML = '';
        Object.keys(files).forEach(filename => {
            const li = document.createElement('li');
            li.className = 'file-item' + (filename === currentFile ? ' active' : '');
            li.innerText = filename;
            li.addEventListener('click', () => switchFile(filename));
            fileListEl.appendChild(li);
        });
    }
    function switchFile(filename) {
        if (filename === currentFile) return;
        files[currentFile] = editor.getValue();
        currentFile = filename;
        editor.setValue(files[currentFile] || '');
        renderFileList();
    }
    btnAddFile.addEventListener('click', () => {
        const newName = prompt("Enter new file name (e.g., utils.c, header.h):");
        if (newName && newName.trim()) {
            if (files[newName]) {
                alert("File already exists!");
                return;
            }
            files[currentFile] = editor.getValue();
            files[newName] = "";
            currentFile = newName;
            editor.setValue(files[currentFile]);
            renderFileList();
        }
    });
    const urlParams = new URLSearchParams(window.location.search);
    const projectId = urlParams.get('id');
    if (projectId) {
        fetch(`/api/projects/${projectId}`)
            .then(res => {
                if (res.ok) return res.json();
                throw new Error('Project not found');
            })
            .then(data => {
                try {
                    const parsed = JSON.parse(data.code);
                    if (typeof parsed === 'object') {
                        files = parsed;
                        currentFile = Object.keys(files)[0] || "main.c";
                    } else {
                        throw new Error("Legacy format");}
                } catch (e) {
                    files = { "main.c": data.code };
                    currentFile = "main.c";}
                editor.setValue(files[currentFile] || "");
                renderFileList();
            })
            .catch(err => {
                console.error(err);
                alert("Failed to load project: " + projectId);
            });
    } else {
        renderFileList();}
    let breakpoints = new Set();
    let decorations = [];
    let highlightDecorations = [];

    editor.onMouseDown(function (e) {
        if (e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
            const lineNumber = e.target.position.lineNumber;
            if (breakpoints.has(lineNumber)) {
                breakpoints.delete(lineNumber);
            } else {
                breakpoints.add(lineNumber);
            }
            updateBreakpointsUI();
            renderBreakpointTable();
        }
    });

    function updateBreakpointsUI() {
        const newDecorations = [];
        breakpoints.forEach(line => {
            newDecorations.push({
                range: new monaco.Range(line, 1, line, 1),
                options: {
                    isWholeLine: false,
                    glyphMarginClassName: 'breakpoint-glyph'
                }
            });
        });
        decorations = editor.deltaDecorations(decorations, newDecorations);
    }
    
    window.getBreakpoints = () => Array.from(breakpoints).sort((a, b) => a - b);
    window.removeBreakpoint = (line) => {
        breakpoints.delete(Number(line));
        updateBreakpointsUI();
        renderBreakpointTable();
    };
    window.highlightLine = (line) => {
        highlightDecorations = editor.deltaDecorations(highlightDecorations, [
            {
                range: new monaco.Range(line, 1, line, 1),
                options: {
                    isWholeLine: true,
                    className: 'debug-highlight',
                    glyphMarginClassName: 'debug-glyph'
                }
            }
        ]);
    };
    window.clearHighlight = () => {
        highlightDecorations = editor.deltaDecorations(highlightDecorations, []);
    };
});

terminal = new Terminal({
    theme: {
        background: '#ffffff',
        foreground: '#17202a',
        cursor: '#2563eb',
        selectionBackground: '#bfdbfe'
    }
});
fitAddon = new FitAddon.FitAddon();
terminal.loadAddon(fitAddon);
terminal.open(document.getElementById('terminal-container'));
fitAddon.fit();

window.addEventListener('resize', () => {
    fitAddon.fit();
});

const btnRun = document.getElementById('btn-run');
const btnDebug = document.getElementById('btn-debug');
const btnDebugStart = document.getElementById('btn-debug-start');
const btnContinue = document.getElementById('btn-continue');
const btnStepOver = document.getElementById('btn-step-over');
const btnStepInto = document.getElementById('btn-step-into');
const btnStop = document.getElementById('btn-stop');

ws = null;

function startExecution(isDebug) {
    if (ws) {
        ws.close();
    }

    setAppMode(isDebug ? 'debug' : 'run');
    terminal.clear();
    terminal.writeln(isDebug ? 'Starting debugger...' : 'Running program...');
    if (window.clearHighlight) window.clearHighlight();
    showVariablesStatus(isDebug ? 'Starting debugger...' : 'Run mode does not inspect variables.');
    showCallStackStatus(isDebug ? 'Starting debugger...' : 'Run mode does not inspect call stack.');
    
    const breakpoints = window.getBreakpoints ? window.getBreakpoints() : [];
    
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/exec`;
    ws = new WebSocket(wsUrl);
    //success connect
    ws.onopen = () => {
        terminal.writeln('\r\n[Connected]\r\n');
        files[currentFile] = editor.getValue();
        ws.send(JSON.stringify({
            code: JSON.stringify(files),
            debug: isDebug,
            breakpoints: breakpoints
        }));  // execute req
    };
    // when api send smth
    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'stdout') {
            if (msg.data.includes('[GDB]')) {
                parseGdbMessages(msg.data).forEach(handleGdbMessage);
            } else {
                terminal.write(msg.data);
            }
        } else if (msg.type === 'status') {
            terminal.write(msg.data);
            ws.close();
        }
    };
    
    ws.onclose = () => {
        terminal.writeln('\r\n[Disconnected]\r\n');
        ws = null;
        if (window.clearHighlight) window.clearHighlight();
    };
    
    ws.onerror = () => {
        terminal.writeln('\r\n[WebSocket Error]\r\n');
    };
}

function parseGdbMessages(data) {
    const messages = [];
    const parts = data.split('[GDB]');
    for (let i = 1; i < parts.length; i++) {
        const part = parts[i].trim();
        if (!part) continue;
        // find json
        const start = part.indexOf('{');
        const end = part.lastIndexOf('}');
        if (start === -1 || end === -1 || end < start) continue;

        try {
            messages.push(JSON.parse(part.slice(start, end + 1)));
        } catch (e) {
            console.warn('Failed to parse GDB message', e, part);
        }
    }
    return messages;
}

function handleGdbMessage(gdbMsg) {
    if (['console', 'target', 'log', 'output'].includes(gdbMsg.type)) {
        handleGdbOutput(gdbMsg.payload || '');
        return;
    }

    if ((gdbMsg.type === 'notify' || gdbMsg.type === 'result') && gdbMsg.message === 'running') {
        if (window.clearHighlight) window.clearHighlight();
        showVariablesStatus('Program running...');
        showCallStackStatus('Program running...');
        return;
    }

    if ((gdbMsg.type === 'notify' || gdbMsg.type === 'result') && gdbMsg.message === 'stopped') {
        const payload = gdbMsg.payload;
        if (payload && payload.frame && payload.frame.line) {
            const line = parseInt(payload.frame.line);
            if (window.highlightLine) window.highlightLine(line);
            showVariablesStatus('Paused. Loading local variables...');
            showCallStackStatus('Paused. Loading call stack...');
        } else if (payload && payload.reason === 'exited-normally') {
            if (window.clearHighlight) window.clearHighlight();
            showVariablesStatus('Program exited. No active stack frame.');
            showCallStackStatus('Program exited. No active stack frame.');
        }
    } else if (gdbMsg.type === 'result' && gdbMsg.message === 'done' && gdbMsg.payload && Array.isArray(gdbMsg.payload.variables)) {
        updateVariables(gdbMsg.payload.variables);
    } else if (gdbMsg.type === 'result' && gdbMsg.message === 'done' && gdbMsg.payload && Array.isArray(gdbMsg.payload.stack)) {
        updateCallStack(gdbMsg.payload.stack);
    }
}

function handleGdbOutput(payload) {
    if (!payload || payload.startsWith('-')) return;
    terminal.write(payload.endsWith('\n') ? payload : payload + '\r\n');
}

function showVariablesStatus(message) {
    showDebuggerStatus('variables-list', message);
}

function showCallStackStatus(message) {
    showDebuggerStatus('callstack-list', message);
}

function showDebuggerStatus(elementId, message) {
    const container = document.getElementById(elementId);
    container.className = 'debug-empty';
    container.textContent = message;
}

function updateVariables(vars) { //local variables
    const container = document.getElementById('variables-list');
    container.innerHTML = '';
    container.className = '';

    if (!vars || vars.length === 0) {
        showVariablesStatus('No local variables in the current scope.');
        return;
    }

    const table = document.createElement('table');
    table.className = 'debug-table';

    const thead = document.createElement('thead');
    thead.innerHTML = '<tr><th>Variable</th><th>Value</th></tr>';
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    vars.forEach(v => {
        const row = document.createElement('tr');
        const name = document.createElement('td');
        const value = document.createElement('td');
        name.textContent = v.name || '';
        value.textContent = v.value !== undefined ? v.value : '<optimized out>';
        row.appendChild(name);
        row.appendChild(value);
        tbody.appendChild(row);
    });
    table.appendChild(tbody);
    container.appendChild(table);
}

function updateCallStack(frames) {
    const container = document.getElementById('callstack-list');
    container.innerHTML = '';
    container.className = '';

    if (!frames || frames.length === 0) {
        showCallStackStatus('No stack frames available.');
        return;
    }

    const table = document.createElement('table');
    table.className = 'debug-table callstack-table';

    const thead = document.createElement('thead');
    thead.innerHTML = '<tr><th>#</th><th>Function</th><th>File:Line</th></tr>';
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    frames.forEach(frame => {
        const row = document.createElement('tr');
        const level = document.createElement('td');
        const func = document.createElement('td');
        const location = document.createElement('td');
        const file = frame.file ? frame.file.replace('/app/', '') : '';
        const line = frame.line ? `:${frame.line}` : '';

        level.textContent = frame.level || '';
        func.textContent = frame.func || '??';
        location.textContent = file ? `${file}${line}` : frame.addr || '??';
        row.appendChild(level);
        row.appendChild(func);
        row.appendChild(location);
        tbody.appendChild(row);
    });
    table.appendChild(tbody);
    container.appendChild(table);
}
btnRun.addEventListener('click', () => startExecution(false));
btnDebug.addEventListener('click', () => {
    setAppMode('debug');
    terminal.clear();
    terminal.writeln('Debug mode ready. Set breakpoints, then press Start.');
    showVariablesStatus('Press Start to inspect local variables.');
    showCallStackStatus('Press Start to inspect stack frames.');
    renderBreakpointTable();
});
btnDebugStart.addEventListener('click', () => startExecution(true));

function sendGdbCommand(cmd, statusMessage) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        if (window.clearHighlight) window.clearHighlight();
        if (statusMessage) {
            showVariablesStatus(statusMessage);
            showCallStackStatus(statusMessage);
        }
        ws.send(JSON.stringify({
            type: 'stdin',
            data: GDB_COMMAND_PREFIX + cmd + '\n'
        })); //constep
    }
}

btnContinue.addEventListener('click', () => sendGdbCommand('-exec-continue', 'Continuing program...'));
btnStepOver.addEventListener('click', () => sendGdbCommand('-exec-next', 'Stepping over...'));
btnStepInto.addEventListener('click', () => sendGdbCommand('-exec-step', 'Stepping into...'));

terminal.onData((data) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'stdin',
            data: data
        })); // teminal inp
    }
}); 

btnStop.addEventListener('click', () => {
    if (ws) {
        ws.close();
    }
    terminal.writeln('\r\n[Stopped]\r\n');
});

const btnLogin = document.getElementById('btn-login');
const btnLogout = document.getElementById('btn-logout');
const userGreeting = document.getElementById('user-greeting');
const btnSave = document.getElementById('btn-save');
const shareLink = document.getElementById('share-link');

const authModal = document.getElementById('auth-modal');
const authClose = document.getElementById('auth-close');
const authSubmit = document.getElementById('auth-submit');
const authUsername = document.getElementById('auth-username');
const authPassword = document.getElementById('auth-password');
const authError = document.getElementById('auth-error');
const authSwitchLink = document.getElementById('auth-switch-link');
const authSwitchText = document.getElementById('auth-switch-text');
const authTitle = document.getElementById('auth-title');

let isLoginMode = true;

fetch('/api/me').then(res => {
    if (res.ok) return res.json();
    throw new Error('Not logged in');
}).then(data => {
    userGreeting.innerText = `Hello, ${data.username}`;
    userGreeting.style.display = 'inline';
    btnLogout.style.display = 'inline-block';
    btnLogin.style.display = 'none';
}).catch(() => {
});

btnLogin.addEventListener('click', () => {
    authModal.style.display = 'flex';
});

authClose.addEventListener('click', () => {
    authModal.style.display = 'none';
    authError.innerText = '';
});

authSwitchLink.addEventListener('click', (e) => {
    e.preventDefault();
    isLoginMode = !isLoginMode;
    authTitle.innerText = isLoginMode ? 'Login' : 'Register';
    authSubmit.innerText = isLoginMode ? 'Login' : 'Register';
    authSwitchText.innerText = isLoginMode ? "Don't have an account? " : "Already have an account? ";
    authSwitchLink.innerText = isLoginMode ? 'Register' : 'Login';
    authError.innerText = '';
});

authSubmit.addEventListener('click', () => {
    const username = authUsername.value.trim();
    const password = authPassword.value;
    
    if (!username || !password) {
        authError.innerText = 'Username and password are required.';
        return;
    }
    
    const endpoint = isLoginMode ? '/api/login' : '/api/register';
    fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    }).then(res => res.json().then(data => ({ status: res.status, body: data })))
      .then(res => {
          if (res.status !== 200) {
              authError.innerText = res.body.detail || res.body.message || 'Authentication failed';
          } else {
              if (!isLoginMode) {
                  authError.style.color = 'green';
                  authError.innerText = 'Registration successful! Please login.';
                  setTimeout(() => {
                      authError.style.color = '#dc3545';
                      authError.innerText = '';
                      isLoginMode = true;
                      authTitle.innerText = 'Login';
                      authSubmit.innerText = 'Login';
                      authSwitchText.innerText = "Don't have an account? ";
                      authSwitchLink.innerText = 'Register';
                  }, 2000);
              } else {
                  window.location.reload();
              }
          }
      });
});

btnLogout.addEventListener('click', () => {
    fetch('/api/logout', { method: 'POST' }).then(() => {
        window.location.reload();
    });
});

btnSave.addEventListener('click', () => {
    if (!editor) return;
    files[currentFile] = editor.getValue();
    const codePayload = JSON.stringify(files);
    
    btnSave.innerText = 'Saving...';
    btnSave.disabled = true;
    
    fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Untitled', code: codePayload })
    }).then(res => res.json()).then(data => {
        btnSave.innerText = 'Save';
        btnSave.disabled = false;
        
        if (data.project_id) {
            const newUrl = window.location.protocol + "//" + window.location.host + window.location.pathname + '?id=' + data.project_id;
            window.history.pushState({path:newUrl},'',newUrl);
            shareLink.style.display = 'inline-block';
            shareLink.value = newUrl;
            shareLink.select();
        }
    }).catch(err => {
        console.error(err);
        btnSave.innerText = 'Save';
        btnSave.disabled = false;
        alert('Failed to save project.');
    });
});
