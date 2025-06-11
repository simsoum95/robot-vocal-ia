const express = require("express");
const bodyParser = require("body-parser");
const { OpenAI } = require("openai");
const twilio = require("twilio");
const nodemailer = require("nodemailer");

require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Configuration email
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

app.use(bodyParser.urlencoded({ extended: false }));

// Fonction pour vérifier les horaires d'ouverture
function isBusinessHours() {
  const now = new Date();
  const day = now.getDay(); // 0 = Dimanche, 1 = Lundi, etc.
  const hour = now.getHours();
  
  // Lundi à Jeudi (1-4): 9h-17h
  if (day >= 1 && day <= 4) {
    return hour >= 9 && hour < 17;
  }
  // Vendredi (5): 9h-13h
  if (day === 5) {
    return hour >= 9 && hour < 13;
  }
  // Weekend fermé
  return false;
}

// Fonction pour envoyer un email
async function sendEmail(subject, message, senderInfo = '') {
  try {
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: 'simonhaliwa@gmail.com',
      subject: `Dream Team - ${subject}`,
      text: `${message}\n\n${senderInfo}`
    };
    
    await transporter.sendMail(mailOptions);
    console.log('Email envoyé avec succès');
    return true;
  } catch (error) {
    console.error('Erreur envoi email:', error);
    return false;
  }
}

let conversationContext = {};

app.post("/voice", async (req, res) => {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();

  // Vérifier les horaires d'ouverture
  if (!isBusinessHours()) {
    const gather = twiml.gather({
      input: "speech",
      speechTimeout: "auto",
      action: "/process-after-hours",
      method: "POST",
      language: "fr-FR",
      voice: "alice"
    });

    gather.say(
      {
        voice: "alice",
        language: "fr-FR"
      },
      "Bonjour, vous êtes bien chez Dream Team. Vous appelez en dehors de nos horaires d'ouverture. Nos horaires sont du lundi au jeudi de 9h à 17h, et le vendredi de 9h à 13h. Vous pouvez laisser un message vocal, il sera transmis à Monsieur Haliwa par email."
    );
  } else {
    const gather = twiml.gather({
      input: "speech",
      speechTimeout: "auto",
      action: "/process",
      method: "POST",
      language: "fr-FR",
      voice: "alice"
    });

    gather.say(
      {
        voice: "alice",
        language: "fr-FR"
      },
      "Bonjour, vous êtes bien chez Dream Team. Comment puis-je vous aider ?"
    );
  }

  res.type("text/xml");
  res.send(twiml.toString());
});

app.post("/process-after-hours", async (req, res) => {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();

  const userSpeech = req.body.SpeechResult;

  if (!userSpeech) {
    twiml.say({ voice: "alice", language: "fr-FR" }, "Désolé, je n'ai pas compris votre message. Au revoir.");
    twiml.hangup();
    res.type("text/xml");
    return res.send(twiml.toString());
  }

  // Envoyer le message vocal par email
  const emailSent = await sendEmail(
    "Message vocal hors horaires",
    `Message vocal reçu en dehors des horaires d'ouverture:\n\n"${userSpeech}"`,
    `Reçu le: ${new Date().toLocaleString('fr-FR')}`
  );

  if (emailSent) {
    twiml.say({ voice: "alice", language: "fr-FR" }, "Merci, votre message a été transmis à Monsieur Haliwa. Il vous recontactera dès que possible. Bonne journée.");
  } else {
    twiml.say({ voice: "alice", language: "fr-FR" }, "Désolé, une erreur est survenue. Veuillez rappeler plus tard. Au revoir.");
  }

  twiml.hangup();
  res.type("text/xml");
  res.send(twiml.toString());
});

app.post("/process", async (req, res) => {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();

  const userSpeech = req.body.SpeechResult;
  const callSid = req.body.CallSid;

  if (!userSpeech) {
    twiml.say({ voice: "alice", language: "fr-FR" }, "Désolé, je n'ai pas compris. Pouvez-vous répéter ?");
    twiml.redirect("/voice");
    res.type("text/xml");
    return res.send(twiml.toString());
  }

  // Si la personne dit "non" -> on raccroche
  if (userSpeech.trim().toLowerCase().includes("non") && !userSpeech.toLowerCase().includes("rendez-vous")) {
    twiml.say({ voice: "alice", language: "fr-FR" }, "Très bien, je raccroche. Bonne journée.");
    twiml.hangup();
    res.type("text/xml");
    return res.send(twiml.toString());
  }

  try {
    // Analyser l'intention avec GPT
    const intentAnalysis = await openai.chat.completions.create({
      model: "gpt-4o-mini-2024-07-18",
      messages: [
        { 
          role: "system", 
          content: `Tu es un analyseur d'intentions pour un standard téléphonique. Analyse le message de l'appelant et réponds UNIQUEMENT par l'un de ces mots:
          - "RENDEZ_VOUS" si la personne veut prendre rendez-vous avec Monsieur Haliwa
          - "PROBLEME" si la personne expose un problème ou pose une question
          - "AUTRE" pour tout autre cas
          
          Ne réponds que par un seul mot.`
        },
        { role: "user", content: userSpeech }
      ]
    });

    const intention = intentAnalysis.choices[0].message.content.trim();

    if (intention === "RENDEZ_VOUS") {
      // Gestion des rendez-vous
      if (!conversationContext[callSid]) {
        conversationContext[callSid] = { step: "rdv_choice" };
        
        const gather = twiml.gather({
          input: "speech",
          speechTimeout: "auto",
          action: "/process",
          method: "POST",
          language: "fr-FR",
          voice: "alice"
        });

        gather.say({ 
          voice: "alice", 
          language: "fr-FR" 
        }, "Très bien. Souhaitez-vous que je vous envoie un email avec les prochaines disponibilités, ou que je vous transfère maintenant à Monsieur Haliwa ?");
        
      } else if (conversationContext[callSid].step === "rdv_choice") {
        if (userSpeech.toLowerCase().includes("email") || userSpeech.toLowerCase().includes("mail")) {
          // Demander l'email
          conversationContext[callSid].step = "get_email";
          
          const gather = twiml.gather({
            input: "speech",
            speechTimeout: "auto",
            action: "/process",
            method: "POST",
            language: "fr-FR",
            voice: "alice"
          });

          gather.say({ 
            voice: "alice", 
            language: "fr-FR" 
          }, "Parfait. Pouvez-vous me donner votre adresse email s'il vous plaît ?");
          
        } else if (userSpeech.toLowerCase().includes("transf") || userSpeech.toLowerCase().includes("maintenant")) {
          // Transférer l'appel
          twiml.say({ voice: "alice", language: "fr-FR" }, "Je vous transfère à Monsieur Haliwa. Veuillez patienter.");
          twiml.dial("+972584469947");
          delete conversationContext[callSid];
        } else {
          // Redemander le choix
          const gather = twiml.gather({
            input: "speech",
            speechTimeout: "auto",
            action: "/process",
            method: "POST",
            language: "fr-FR",
            voice: "alice"
          });

          gather.say({ 
            voice: "alice", 
            language: "fr-FR" 
          }, "Je n'ai pas bien compris. Préférez-vous recevoir un email avec les disponibilités, ou être transféré directement à Monsieur Haliwa ?");
        }
      } else if (conversationContext[callSid].step === "get_email") {
        // Envoyer l'email avec les disponibilités
        const emailSent = await sendEmail(
          "Demande de rendez-vous",
          `Nouvelle demande de rendez-vous.\n\nEmail de contact: ${userSpeech}\n\nMessage original: "${conversationContext[callSid].originalMessage || 'Demande de rendez-vous'}"`,
          `Reçu le: ${new Date().toLocaleString('fr-FR')}`
        );

        if (emailSent) {
          twiml.say({ voice: "alice", language: "fr-FR" }, "Parfait, un email avec les disponibilités de Monsieur Haliwa vous sera envoyé sous peu. Merci de votre appel et bonne journée.");
        } else {
          twiml.say({ voice: "alice", language: "fr-FR" }, "Désolé, une erreur est survenue. Veuillez rappeler plus tard ou contacter directement Monsieur Haliwa au +972584469947.");
        }
        
        twiml.hangup();
        delete conversationContext[callSid];
      }

    } else if (intention === "PROBLEME") {
      // Gestion des problèmes/questions
      if (!conversationContext[callSid]) {
        conversationContext[callSid] = { step: "get_problem", originalMessage: userSpeech };
        
        const gather = twiml.gather({
          input: "speech",
          speechTimeout: "auto",
          action: "/process",
          method: "POST",
          language: "fr-FR",
          voice: "alice"
        });

        gather.say({ 
          voice: "alice", 
          language: "fr-FR" 
        }, "Merci, je vais transmettre votre message à la direction. Pouvez-vous me résumer votre demande en une ou deux phrases ?");
        
      } else if (conversationContext[callSid].step === "get_problem") {
        // Envoyer le problème par email
        const emailSent = await sendEmail(
          "Question/Problème client",
          `Nouveau message d'un client:\n\n"${userSpeech}"\n\nMessage initial: "${conversationContext[callSid].originalMessage}"`,
          `Reçu le: ${new Date().toLocaleString('fr-FR')}`
        );

        if (emailSent) {
          twiml.say({ voice: "alice", language: "fr-FR" }, "Merci, votre message a été transmis à la direction. Vous recevrez une réponse dans les plus brefs délais. Bonne journée.");
        } else {
          twiml.say({ voice: "alice", language: "fr-FR" }, "Désolé, une erreur est survenue. Veuillez rappeler plus tard.");
        }
        
        twiml.hangup();
        delete conversationContext[callSid];
      }

    } else {
      // Cas général - utiliser GPT pour répondre
      const chatCompletion = await openai.chat.completions.create({
        model: "gpt-4o-mini-2024-07-18",
        messages: [
          { 
            role: "system", 
            content: "Tu es l'assistante téléphonique de Dream Team. Tu es polie, professionnelle et efficace. Tu parles en français. Si la personne veut un rendez-vous, propose email ou transfert. Si elle a un problème, propose de transmettre le message. Sois concise et claire."
          },
          { role: "user", content: userSpeech }
        ]
      });

      const aiReply = chatCompletion.choices[0].message.content;

      const gather = twiml.gather({
        input: "speech",
        speechTimeout: "auto",
        action: "/process",
        method: "POST",
        language: "fr-FR",
        voice: "alice"
      });

      gather.say({ voice: "alice", language: "fr-FR" }, aiReply);
    }

    res.type("text/xml");
    res.send(twiml.toString());

  } catch (error) {
    console.error("Erreur GPT:", error);
    twiml.say({ voice: "alice", language: "fr-FR" }, "Une erreur est survenue. Veuillez réessayer plus tard.");
    twiml.hangup();
    res.type("text/xml");
    res.send(twiml.toString());
  }
});

app.listen(port, () => {
  console.log(`Standard téléphonique Dream Team actif sur le port ${port}`);
});