// index.js
import express from "express";
import bodyParser from "body-parser";
import { OpenAI } from "openai";
import { Twilio } from "twilio";
import { writeFile } from "fs/promises";
import fetch from "node-fetch";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const twilio = new Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

app.use(bodyParser.urlencoded({ extended: false }));
app.use("/public", express.static(path.join(__dirname, "public")));

let lastUserText = "";

app.post("/voice", async (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.gather({ input: "speech", action: "/response", method: "POST", language: "fr-FR" })
      .say({ voice: "alice", language: "fr-FR" }, "Bonjour, je suis l'assistante de Monsieur Haliwa, expert en intelligence artificielle. Comment puis-je vous aider aujourd'hui ?");
  res.type("text/xml").send(twiml.toString());
});

app.post("/response", async (req, res) => {
  const userText = req.body.SpeechResult || "";
  lastUserText = userText.toLowerCase();

  if (lastUserText.includes("non")) {
    const hangupResponse = new twilio.twiml.VoiceResponse();
    hangupResponse.say({ voice: "alice", language: "fr-FR" }, "Très bien, je vous souhaite une excellente journée. Au revoir.");
    hangupResponse.hangup();
    return res.type("text/xml").send(hangupResponse.toString());
  }

  const aiResponse = await openai.chat.completions.create({
    model: "gpt-4o-mini-2024-07-18",
    messages: [
      { role: "system", content: "Tu es une assistante vocale professionnelle, chaleureuse et très polie. Tu réponds toujours en français, avec un ton naturel, calme et humain." },
      { role: "user", content: lastUserText }
    ],
    temperature: 0.6,
  });

  const text = aiResponse.choices[0].message.content;
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.say({ voice: "alice", language: "fr-FR" }, text);
  twiml.gather({ input: "speech", action: "/response", method: "POST", language: "fr-FR" });

  res.type("text/xml").send(twiml.toString());
});

app.listen(port, () => {
  console.log("Serveur actif sur le port " + port);
});
