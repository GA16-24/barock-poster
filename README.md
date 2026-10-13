# Barock-Plakat, analog und digital

Dieses Repo gehört zu einer Aufgabe aus dem Deutschunterricht. Wir gestalten ein Plakat zum Barock, und zwar in zwei Versionen. Die analoge Version ist ein echtes Plakat auf Papier. Die digitale Version entsteht hier im Repo. Sie ist eine Augmented-Reality-Webseite fürs Handy, die das Plakat in den Raum erweitert.

Die Webseite heißt **Thermo Blade**. Richtet man die Handykamera auf den EMMETI-Thermostat an der Wand, erscheint rechts daneben ein Schwert im Retro-Pixel-Stil. Das Schwert ist ein echtes 3D-Modell und bleibt an seinem Platz im Raum, wenn man sich mit dem Handy bewegt.

Live: https://thermo-blade.netlify.app

## Benutzung

1. Die Seite auf dem Handy öffnen. Gedacht ist sie für Safari auf dem iPhone, Chrome auf Android sollte auch gehen.
2. START tippen und Kamera und Bewegungssensoren erlauben.
3. Die Kamera auf den Thermostat richten. Rechts davon sollte etwas Wand im Bild sein, denn dort erscheint das Schwert.
4. Sobald der Thermostat erkannt ist, steht oben "SWORD DRAWN" und das Schwert taucht auf. Verliert die Kamera den Thermostat, verschwindet es nach einer halben Sekunde wieder.

Die Kamera funktioniert nur über https. Eine lokal über das WLAN geöffnete Seite zeigt deshalb eine Fehlermeldung.

## Wie es funktioniert

**Erkennung.** Fertige AR-Bibliotheken wie MindAR suchen nach Bildmustern mit vielen Details. Der Thermostat hat fast keine, MindAR fand ihn nur auf 2 bis 3 von 15 Testfotos. Deshalb sucht `site/detect.js` gezielt nach dem dunklen Display im hellen Gehäuse. Das Programm wandelt jedes Kamerabild in Graustufen um, probiert mehrere Helligkeitsschwellen aus und behält dunkle Rechtecke mit passendem Seitenverhältnis und hellem Rand. Ein Vergleich mit einer gespeicherten Vorlage aus Foto `0442.jpg` sortiert den schwarzen Kartenleser aus, der direkt neben dem Thermostat hängt. Zum Schluss werden die vier Kanten des Displays auf Bruchteile eines Pixels genau gemessen, sonst wackelt das Schwert.

**Lage im Raum.** Aus den vier Ecken des Displays und seiner echten Größe von 6,1 × 4,5 cm berechnet `site/pose.js`, wo der Thermostat relativ zur Kamera hängt und wie er gedreht ist. Der Gyrosensor des Handys liefert dazu die Drehung der Kamera. Damit rechnet die App die Position in ein festes Raumkoordinatensystem um, und das Schwert bleibt an der Wand stehen, statt am Bildschirm zu kleben.

**Das Schwert.** `site/sword.js` beschreibt das Schwert als Pixelbild mit 11 × 33 Pixeln in der Sweetie-16-Farbpalette. Jedes Pixel wird ein kleiner Würfel, so entsteht ein 3D-Modell von 20 cm Höhe. Gezeichnet wird mit three.js in halber Auflösung, das gibt den groben Pixel-Look.

Die Seite lädt nichts von fremden Servern. three.js liegt als Kopie in `site/vendor`, weil CDNs aus Shanghai oft langsam oder gar nicht erreichbar sind.

## Ordner

```
ar-sword/
  site/         die Webseite, so wie sie online geht
  test/         Testskripte und die Fotos vom Thermostat
  package.json  Befehle für Tests und Veröffentlichung
```

## Entwicklung

Man braucht Node.js, ffmpeg, Python 3 und Google Chrome.

```sh
cd ar-sword
npm install
npm run vendor      # kopiert three.js nach site/vendor
cd site && python3 -m http.server 8000
```

Am Computer läuft die Seite dann unter http://localhost:8000. Auf `localhost` erlaubt der Browser die Kamera auch ohne https.

### Tests

Die Tests starten Chrome mit einer künstlichen Kamera, die ein Video aus den Testfotos abspielt.

| Befehl | prüft |
| --- | --- |
| `npm run test:detect` | Erkennung auf 15 Fotos mit und 8 Fotos ohne Thermostat |
| `npm run test:pose` | Lageberechnung mit erfundenen Ecken, deren Ergebnis bekannt ist |
| `npm run test:jitter` | wie stark das Schwert bei wackelnder Kamera zittert |
| `npm run test:world` | ob das Schwert beim Schwenken an seinem Platz im Raum bleibt |
| `npm run test:app` | die ganze Seite von START bis "SWORD DRAWN", mit Screenshots in `test/out` |
| `npm run test:video -- <video>` | Erkennung Bild für Bild in einem echten Handyvideo |

`test:app` prüft mit `APP_URL=https://thermo-blade.netlify.app npm run test:app` auch die Live-Seite.

Das Handyvideo `IMG_0447.MOV`, mit dem die Erkennung aus 1 bis 3 m Entfernung eingestellt wurde, ist nicht im Repo. Darauf sind Mitschüler zu sehen.

### Veröffentlichen

```sh
cd ar-sword
npm run deploy
```

Das lädt den Ordner `site` zu Netlify hoch. Dafür muss die Netlify CLI installiert und angemeldet sein.

## Grenzen

- Die App kennt nur diesen einen Thermostat. Andere Geräte mit dunklem Display im hellen Rahmen kann sie damit verwechseln.
- Die Brennweite der Kamera ist geschätzt. Auf manchen Handys steht das Schwert deshalb etwas zu nah oder zu weit weg.
- Ohne Gyrosensor funktioniert die Seite auch, das Schwert verschwindet dann aber sofort, sobald der Thermostat aus dem Bild ist.
