const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const { OpenAI } = require("openai");
const { Twilio } = require("twilio");
const { VoiceResponse } = require("twilio").twiml;
require("dotenv").config();

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));

const port = process.env.PORT || 3000;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const client = new Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

let previousPrompt = "Tu es l'assistante de Monsieur Haliwa, expert en intelligence artificielle. Tu parles poliment, avec une voix douce, professionnelle et rassurante.";

app.post("/voice", async (req, res) => {
  const twiml = new VoiceResponse();
  const gather = twiml.gather({ input: "speech", action: "/gather", method: "POST", timeout: 6 });
  gather.say("Bonjour, je suis l'assistante de Monsieur Haliwa, expert en intelligence artificielle. Comment puis-je vous aider aujourd'hui ?", { language: "fr-FR", voice: "alice" });
  res.type("text/xml");
  res.send(twiml.toString());
});

app.post("/gather", async (req, res) => {
  const userSpeech = req.body.SpeechResult;
  console.log("Utilisateur a dit :", userSpeech);

  if (!userSpeech || userSpeech.toLowerCase().includes("non")) {
    const twiml = new VoiceResponse();
    twiml.say("Très bien, je vous souhaite une excellente journée. Au revoir !", { language: "fr-FR", voice: "alice" });
    twiml.hangup();
    res.type("text/xml");
    return res.send(twiml.toString());
  }

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: previousPrompt },
        { role: "user", content: userSpeech }
      ]
    });

    const responseText = completion.choices[0].message.content;
    previousPrompt += `\nUtilisateur : ${userSpeech}\nAssistante : ${responseText}`;

    const twiml = new VoiceResponse();
    const gather = twiml.gather({ input: "speech", action: "/gather", method: "POST", timeout: 6 });
    gather.say(responseText, { language: "fr-FR", voice: "alice" });
    res.type("text/xml");
    res.send(twiml.toString());
  } catch (error) {
    console.error("Erreur GPT:", error);
    const twiml = new VoiceResponse();
    twiml.say("Désolé, une erreur est survenue.", { language: "fr-FR", voice: "alice" });
    twiml.hangup();
    res.type("text/xml");
    res.send(twiml.toString());
  }
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Serveur actif sur le port ${port}`);
});
