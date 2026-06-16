let editor;
require.config({
    paths: {
        vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.52.2/min/vs'
    }
});
require(
    ['vs/editor/editor.main'],
    function () {
        editor = monaco.editor.create(
            document.getElementById('editor'),
            {
                value: '#include <stdio.h>\n\nint main() {\n    printf("Hello, World!\\n");\n    return 0;\n}',
                language: 'c',
                theme: 'vs',
                automaticLayout: true,
                minimap: { enabled: false }
            }
        );
    }
);

let term;
let fitAddon;

term = new Terminal({
    theme: {
        background: '#fafafa',
        foreground: '#000000',
        cursor: '#000000',
        selectionBackground: '#cccccc'
    },
    convertEol: true,
    fontFamily: 'monospace',
    fontSize: 14
});

if (window.FitAddon) {
    fitAddon = new window.FitAddon.FitAddon();
    term.loadAddon(fitAddon);
}

term.open(document.getElementById('terminal-container'));
if (fitAddon) {
    fitAddon.fit();
    window.addEventListener('resize', () => fitAddon.fit());
}
term.write('Ready...\r\n');

async function runCode() {
    if (!editor || !term) return;

    const runBtn = document.getElementById('run-btn');

    runBtn.disabled = true;
    term.clear();
    term.write("Running code...\r\n");

    try {
        const response = await fetch(
            "http://127.0.0.1:8000/run",
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    code: editor.getValue(),
                    stdin: document.getElementById("stdin").value
                })
            }
        );
        const data = await response.json();

        term.clear();
        if (data.error && !data.output) {
            term.write(data.error + '\r\n');
        } else if (data.error && data.output) {
            term.write(data.output + '\r\n\r\nError/Warnings:\r\n' + data.error + '\r\n');
        } else {
            term.write(data.output || "Program finished with no output.\r\n");
        }
    } catch (err) {
        term.clear();
        term.write("Error connecting to backend: " + err.message + '\r\n');
    } finally {
        runBtn.disabled = false;
    }
}

function downloadCode() {
    if (!editor) return;
    const code = editor.getValue();
    const blob = new Blob([code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'main.c';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

document.getElementById('file-upload').addEventListener('change', function (e) {
    const file = e.target.files[0];
    if (!file || !editor) return;

    const reader = new FileReader();
    reader.onload = function (e) {
        editor.setValue(e.target.result);
    };
    reader.readAsText(file);

    e.target.value = '';
});