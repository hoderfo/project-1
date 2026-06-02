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
                value:'',
                language: 'python',
                theme: 'vs-dark',
                automaticLayout: true
            }
        );

    }
);

async function runCode() {
    const code = editor.getValue();
    const response = await fetch(
        "http://127.0.0.1:8000/run",
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                code: code
            })
        }
    );
    const data = await response.json();
    document.getElementById("output").textContent =
        data.output || data.error;
}