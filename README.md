# La Liste Infernale

Jeu de culture en ligne de 2 à 6 joueurs. Chacun parie combien de réponses il peut citer en 40 secondes sur un thème ; le plus gros pari joue (avec toute son équipe en mode équipes), et s'il rate, ce sont les adversaires qui marquent.

- `public/index.html` : tout le jeu (interface, règles, 86 thèmes et leurs réponses).
- `server.js` : un petit serveur Node.js qui sert la page, relaie les parties en temps réel (WebSocket) et garde les statistiques des réponses pour le bonus des réponses rares.

## 1. Mettre le site en ligne gratuitement (Render)

1. **Crée un dépôt GitHub** : sur github.com, « New repository », nomme-le `la-liste-infernale`, puis « uploading an existing file » et glisse-dépose tout le contenu de ce dossier (`server.js`, `package.json`, `README.md`, `.gitignore` et le dossier `public`). Valide avec « Commit changes ».
2. **Crée le service sur Render** : sur render.com, connecte-toi avec GitHub, puis « New » → « Web Service » et choisis le dépôt.
3. **Réglages** :
   - Runtime : `Node`
   - Build Command : `npm install`
   - Start Command : `npm start`
   - Instance Type : `Free`
4. Clique sur « Create Web Service ». Au bout de 2 à 3 minutes, Render affiche une adresse du type `https://la-liste-infernale.onrender.com`. C'est le lien à partager.

Sur l'offre gratuite, le serveur s'endort après 15 minutes sans visite : la première ouverture suivante prend environ une minute.

Si tu as déjà mis une version précédente en ligne : remplace simplement les fichiers dans ton dépôt GitHub, Render redéploie tout seul.

## 2. Garder les statistiques (bonus des réponses rares) — recommandé, 5 minutes

Le bonus des réponses rares a besoin de se souvenir de toutes les manches jouées. Sur l'offre gratuite de Render, les fichiers du serveur sont effacés à chaque redémarrage : sans base de données, les statistiques repartent de zéro régulièrement et le bonus ne s'active presque jamais.

Solution gratuite avec Upstash (base Redis) :

1. Crée un compte sur upstash.com, puis « Create Database » (type Redis, offre Free, région Europe).
2. Dans la page de la base, section « REST API », copie `UPSTASH_REDIS_REST_URL` et `UPSTASH_REDIS_REST_TOKEN`.
3. Sur Render, ouvre ton service → « Environment » → ajoute ces deux variables avec leurs valeurs → « Save Changes ». Render redémarre le service.

Le journal de Render affiche alors « stats : Upstash » au démarrage.

## 3. Activer l'envoi des suggestions (une seule fois)

L'onglet « Suggestions » envoie les messages à lalisteinfernale@gmail.com via le service gratuit FormSubmit.
La toute première suggestion envoyée depuis le site déclenche un e-mail de FormSubmit sur lalisteinfernale@gmail.com : clique sur le lien « Activate Form » qu'il contient. Ensuite, toutes les suggestions arrivent directement dans la boîte mail.

Pense à regarder dans les spams si l'e-mail d'activation n'arrive pas.

## Jouer

- **Trois façons de jouer**, au choix dans le salon : « Le plus gros pari », « Chacun son pari » (tout le monde tente son propre pari en même temps) et « Chacun son tour » (une réponse chacun son tour, 30 s de réserve, éliminé à la première erreur).
- **En ligne** : un joueur clique sur « Créer une partie », choisit la façon de jouer, le mode (chacun pour soi, 2 contre 2, 3 contre 3, 2 contre 2 contre 2) et la fin de partie, puis donne le code à 4 lettres. Les autres le tapent et cliquent sur « Rejoindre ».
- **Solo** : atteindre 80 points en un minimum de manches. Le record est gardé sur l'appareil.
- **Un seul écran** : on se passe l'appareil.
- **Mode vocal** : sur l'accueil, « À la voix (micro) ». Ne sert que quand on joue seul la manche (en équipe, on écrit). Fonctionne dans Chrome, Edge et Safari, sur l'adresse https. Firefox ne gère pas la reconnaissance vocale : le site l'indique et le clavier reste disponible.

## Lancer en local (optionnel)

Avec Node.js 18 ou plus : `npm install` puis `npm start`, et ouvre http://localhost:3000.
