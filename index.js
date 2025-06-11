const express = require("express");
const bodyParser = require("body-parser");
const { OpenAI } = require("openai");
const twilio = require("twilio");
const nodemailer = require("nodemailer");

require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Configuration email - CORRECTION: createTransport au lieu de createTransporter
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
  
  // Dimanche à Jeudi (0,1-4): 9h-18h
  if ((day === 0) || (day >= 1 && day <= 4)) {
    return hour >= 9 && hour < 18;
  }
  // Vendredi et Samedi fermé
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
      language: "fr-FR"
    });

    gather.say(
      {
        voice: "Polly.Celine",
        language: "fr-FR"
      },
      "Bonjour, vous êtes bien chez Dream Team. Vous appelez en dehors de nos horaires d'ouverture. Nous sommes ouverts du dimanche au jeudi de 9 heures à 18 heures. Vous pouvez laisser un message vocal, il sera transmis à Monsieur Haliwa par email."
    );
  } else {
    const gather = twiml.gather({
      input: "speech",
      speechTimeout: "auto",
      action: "/process",
      method: "POST",
      language: "fr-FR"
    });

    gather.say(
      {
        voice: "Polly.Celine",
        language: "fr-FR"
      },
      "Bonjour, vous êtes bien chez Dream Team, comment puis-je vous aider ?"
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
    twiml.say({ voice: "Polly.Celine", language: "fr-FR" }, "Désolée, je n'ai pas compris votre message. Au revoir.");
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
    twiml.say({ voice: "Polly.Celine", language: "fr-FR" }, "Merci, votre message a été transmis à Monsieur Haliwa. Il vous recontactera dès que possible. Bonne journée.");
  } else {
    twiml.say({ voice: "Polly.Celine", language: "fr-FR" }, "Désolée, une erreur est survenue. Veuillez rappeler plus tard. Au revoir.");
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
    twiml.say({ voice: "Polly.Celine", language: "fr-FR" }, "Je suis désolée, je n'ai pas bien compris. Pouvez-vous reformuler votre demande ?");
    
    const gather = twiml.gather({
      input: "speech",
      speechTimeout: "auto",
      action: "/process",
      method: "POST",
      language: "fr-FR"
    });
    
    res.type("text/xml");
    return res.send(twiml.toString());
  }

  // Si la personne dit "non" ou veut raccrocher
  if (userSpeech.trim().toLowerCase().includes("non") && !userSpeech.toLowerCase().includes("rendez-vous") && !userSpeech.toLowerCase().includes("problème")) {
    twiml.say({ voice: "Polly.Celine", language: "fr-FR" }, "Très bien, bonne journée.");
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
          - "HORAIRES" si la personne demande les horaires d'ouverture
          - "RENDEZ_VOUS" si la personne veut prendre rendez-vous avec Monsieur Haliwa
          - "PROBLEME" si la personne dit avoir un problème, expose un problème ou pose une question
          - "AUTRE" pour tout autre cas
          
          Ne réponds que par un seul mot.`
        },
        { role: "user", content: userSpeech }
      ]
    });

    const intention = intentAnalysis.choices[0].message.content.trim();

    if (intention === "HORAIRES") {
      // Gestion des demandes d'horaires
      if (!conversationContext[callSid]) {
        conversationContext[callSid] = { step: "horaires_response" };
        
        const gather = twiml.gather({
          input: "speech",
          speechTimeout: "auto",
          action: "/process",
          method: "POST",
          language: "fr-FR"
        });

        gather.say({ 
          voice: "Polly.Celine", 
          language: "fr-FR" 
        }, "Nous sommes ouverts du dimanche au jeudi, de 9 heures à 18 heures. Souhaitez-vous recevoir ces informations par email également ?");
        
      } else if (conversationContext[callSid].step === "horaires_response") {
        if (userSpeech.toLowerCase().includes("oui") || userSpeech.toLowerCase().includes("email")) {
          // Demander l'email pour envoyer les horaires
          conversationContext[callSid].step = "get_email_horaires";
          
          const gather = twiml.gather({
            input: "speech",
            speechTimeout: "auto",
            action: "/process",
            method: "POST",
            language: "fr-FR"
          });

          gather.say({ 
            voice: "Polly.Celine", 
            language: "fr-FR" 
          }, "Parfait. Pouvez-vous me donner votre adresse email s'il vous plaît ?");
          
        } else {
          // Pas d'email souhaité
          twiml.say({ voice: "Polly.Celine", language: "fr-FR" }, "Très bien. Y a-t-il autre chose pour laquelle je peux vous aider ?");
          
          const gather = twiml.gather({
            input: "speech",
            speechTimeout: "auto",
            action: "/process",
            method: "POST",
            language: "fr-FR"
          });
          
          delete conversationContext[callSid];
        }
      } else if (conversationContext[callSid].step === "get_email_horaires") {
        // Envoyer les horaires par email
        const emailSent = await sendEmail(
          "Horaires d'ouverture",
          `Voici nos horaires d'ouverture :\n\nDu dimanche au jeudi : 9h00 - 18h00\nVendredi et samedi : Fermé\n\nPour toute question, n'hésitez pas à nous contacter.`,
          `Email de contact: ${userSpeech}\nEnvoyé le: ${new Date().toLocaleString('fr-FR')}`
        );

        if (emailSent) {
          twiml.say({ voice: "Polly.Celine", language: "fr-FR" }, "Parfait, les horaires d'ouverture vous ont été envoyés par email. Bonne journée.");
        } else {
          twiml.say({ voice: "Polly.Celine", language: "fr-FR" }, "Désolée, une erreur est survenue lors de l'envoi de l'email. Nos horaires sont du dimanche au jeudi de 9 heures à 18 heures.");
        }
        
        twiml.hangup();
        delete conversationContext[callSid];
      }

    } else if (intention === "RENDEZ_VOUS") {
      // Gestion des rendez-vous
      if (!conversationContext[callSid]) {
        conversationContext[callSid] = { step: "rdv_choice", originalMessage: userSpeech };
        
        const gather = twiml.gather({
          input: "speech",
          speechTimeout: "auto",
          action: "/process",
          method: "POST",
          language: "fr-FR"
        });

        gather.say({ 
          voice: "Polly.Celine", 
          language: "fr-FR" 
        }, "Très bien. Préférez-vous que je vous transfère à Monsieur Haliwa, ou que je note votre demande pour lui envoyer par email ?");
        
      } else if (conversationContext[callSid].step === "rdv_choice") {
        if (userSpeech.toLowerCase().includes("transf") || userSpeech.toLowerCase().includes("parler") || userSpeech.toLowerCase().includes("maintenant")) {
          // Transférer l'appel
          twiml.say({ voice: "Polly.Celine", language: "fr-FR" }, "Je vous transfère à Monsieur Haliwa. Veuillez patienter.");
          twiml.dial("+972584469947");
          delete conversationContext[callSid];
        } else if (userSpeech.toLowerCase().includes("email") || userSpeech.toLowerCase().includes("noter") || userSpeech.toLowerCase().includes("message")) {
          // Demander le message pour le rendez-vous
          conversationContext[callSid].step = "get_rdv_message";
          
          const gather = twiml.gather({
            input: "speech",
            speechTimeout: "auto",
            action: "/process",
            method: "POST",
            language: "fr-FR"
          });

          gather.say({ 
            voice: "Polly.Celine", 
            language: "fr-FR" 
          }, "D'accord. Quel message souhaitez-vous transmettre exactement pour votre demande de rendez-vous ?");
          
        } else {
          // Redemander le choix
          const gather = twiml.gather({
            input: "speech",
            speechTimeout: "auto",
            action: "/process",
            method: "POST",
            language: "fr-FR"
          });

          gather.say({ 
            voice: "Polly.Celine", 
            language: "fr-FR" 
          }, "Je n'ai pas bien compris. Préférez-vous que je vous transfère à Monsieur Haliwa, ou que je note votre demande pour lui envoyer par email ?");
        }
      } else if (conversationContext[callSid].step === "get_rdv_message") {
        // Envoyer la demande de rendez-vous par email
        const emailSent = await sendEmail(
          "Demande de rendez-vous",
          `Nouvelle demande de rendez-vous :\n\n"${userSpeech}"\n\nDemande initiale : "${conversationContext[callSid].originalMessage}"`,
          `Reçu le: ${new Date().toLocaleString('fr-FR')}`
        );

        if (emailSent) {
          twiml.say({ voice: "Polly.Celine", language: "fr-FR" }, "Parfait, votre demande de rendez-vous a été transmise à Monsieur Haliwa. Il vous recontactera dans les plus brefs délais. Bonne journée.");
        } else {
          twiml.say({ voice: "Polly.Celine", language: "fr-FR" }, "Désolée, une erreur est survenue. Veuillez rappeler plus tard ou contacter directement Monsieur Haliwa au +972584469947.");
        }
        
        twiml.hangup();
        delete conversationContext[callSid];
      }

    } else if (intention === "PROBLEME") {
      // Gestion des problèmes/questions
      if (!conversationContext[callSid]) {
        conversationContext[callSid] = { step: "problem_choice", originalMessage: userSpeech };
        
        const gather = twiml.gather({
          input: "speech",
          speechTimeout: "auto",
          action: "/process",
          method: "POST",
          language: "fr-FR"
        });

        gather.say({ 
          voice: "Polly.Celine", 
          language: "fr-FR" 
        }, "D'accord, je peux transmettre cela à la direction. Préférez-vous que je vous transfère à Monsieur Haliwa, ou que je note votre message pour lui envoyer par email ?");
        
      } else if (conversationContext[callSid].step === "problem_choice") {
        if (userSpeech.toLowerCase().includes("transf") || userSpeech.toLowerCase().includes("parler") || userSpeech.toLowerCase().includes("maintenant")) {
          // Transférer l'appel
          twiml.say({ voice: "Polly.Celine", language: "fr-FR" }, "Je vous transfère à Monsieur Haliwa. Veuillez patienter.");
          twiml.dial("+972584469947");
          delete conversationContext[callSid];
        } else if (userSpeech.toLowerCase().includes("email") || userSpeech.toLowerCase().includes("noter") || userSpeech.toLowerCase().includes("message")) {
          // Demander le message détaillé
          conversationContext[callSid].step = "get_problem_message";
          
          const gather = twiml.gather({
            input: "speech",
            speechTimeout: "auto",
            action: "/process",
            method: "POST",
            language: "fr-FR"
          });

          gather.say({ 
            voice: "Polly.Celine", 
            language: "fr-FR" 
          }, "Parfait. Quel message souhaitez-vous transmettre exactement ?");
          
        } else {
          // Redemander le choix
          const gather = twiml.gather({
            input: "speech",
            speechTimeout: "auto",
            action: "/process",
            method: "POST",
            language: "fr-FR"
          });

          gather.say({ 
            voice: "Polly.Celine", 
            language: "fr-FR" 
          }, "Je n'ai pas bien compris. Préférez-vous que je vous transfère à Monsieur Haliwa, ou que je note votre message pour lui envoyer par email ?");
        }
      } else if (conversationContext[callSid].step === "get_problem_message") {
        // Envoyer le problème par email
        const emailSent = await sendEmail(
          "Question/Problème client",
          `Nouveau message d'un client :\n\n"${userSpeech}"\n\nMessage initial : "${conversationContext[callSid].originalMessage}"`,
          `Reçu le: ${new Date().toLocaleString('fr-FR')}`
        );

        if (emailSent) {
          twiml.say({ voice: "Polly.Celine", language: "fr-FR" }, "Merci, votre message a été transmis à la direction. Vous recevrez une réponse dans les plus brefs délais. Bonne journée.");
        } else {
          twiml.say({ voice: "Polly.Celine", language: "fr-FR" }, "Désolée, une erreur est survenue. Veuillez rappeler plus tard.");
        }
        
        twiml.hangup();
        delete conversationContext[callSid];
      }

    } else {
      // Cas général - réponse polie et redirection
      const gather = twiml.gather({
        input: "speech",
        speechTimeout: "auto",
        action: "/process",
        method: "POST",
        language: "fr-FR"
      });

      gather.say({ 
        voice: "Polly.Celine", 
        language: "fr-FR" 
      }, "Je suis désolée, je n'ai pas bien compris votre demande. Souhaitez-vous prendre un rendez-vous, connaître nos horaires, ou avez-vous un problème à signaler ?");
    }

    res.type("text/xml");
    res.send(twiml.toString());

  } catch (error) {
    console.error("Erreur GPT:", error);
    twiml.say({ voice: "Polly.Celine", language: "fr-FR" }, "Une erreur est survenue. Veuillez réessayer plus tard.");
    twiml.hangup();
    res.type("text/xml");
    res.send(twiml.toString());
  }
});

app.listen(port, () => {
  console.log(`Standard téléphonique Dream Team actif sur le port ${port}`);
});