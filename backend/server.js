import express from "express";

const app=express();

app.use(express.json());
app.use(express.static("C:/Users/nhcmu/project-1/frontend"));

app.post("/",(req,res)=>{
    let rep="oke "+req.body.text;
    res.json({reply: rep});
});

app.listen(5000,()=>{
    console.log("running");
});