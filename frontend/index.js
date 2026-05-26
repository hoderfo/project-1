const button=document.getElementById("submit");
const text=document.getElementById("text");
const result=document.getElementById("result");

button.addEventListener("click", async ()=> {
    const response = await fetch(
        "/",
        {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({
                text: text.value
            })
        });
    const data = await response.json();
    result.innerText = data.reply;
});