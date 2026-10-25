# Barock-Plakat, analog und digital

Dieses Repo gehört zu einer Aufgabe aus dem Deutschunterricht. Wir gestalten ein Plakat zum Barock, und zwar in zwei Versionen. Die analoge Version ist ein echtes Plakat auf Papier. Die digitale Version entsteht hier im Repo. Sie ist eine Augmented-Reality-Webseite fürs Handy, die das Plakat in den Raum erweitert.

Die Webseite heißt **Barock im Raum**. Richtet man die Handykamera auf den EMMETI-Thermostat an der Wand, erscheint um ihn herum ein kleines Barock-Museum aus echten 3D-Modellen:

- **In der Mitte drei Dichter:** Johann Valentin Andreae, Jakob Bidermann und Sigmund von Birken als 3D-Köpfe. Unter ihnen liegt das wichtigste Werk des gerade gewählten Dichters als Buch mit der echten Titelseite. Daneben steht eine 3D-Karte seiner Stadt, auf der sich etwas bewegt: Flöße auf dem Neckar in Tübingen, eine Prozession an St. Michael in München, eine Schafherde auf der Hallerwiese in Nürnberg.
- **Links der Adel:** Krone, Schloss, Perücke, Kutsche, Degen, Spiegel, Kronleuchter und Pokal.
- **Rechts das Volk:** Bauernhaus, Pflug, Sense, Brot, Pestmaske, Soldatenhelm, Fass und Spinnrad.

Man greift mit der Hand in das Kamerabild und schließt sie über einem Gegenstand zur Faust. Dann kommt der Gegenstand nach vorne, und daneben erscheint ein kurzer Text in einfacher Sprache. Antippen geht auch.

Die alte Version mit dem Pixel-Schwert heißt Thermo Blade und liegt noch unter https://thermo-blade.netlify.app.

## Benutzung

1. Die Seite auf dem Handy öffnen. Gedacht ist sie für Safari auf dem iPhone, Chrome auf Android sollte auch gehen.
2. START tippen und Kamera und Bewegungssensoren erlauben.
3. Aus 1,5 bis 2 m Abstand die Kamera auf den Thermostat richten. Sobald er erkannt ist, steht unten "GEFUNDEN" und die Szene erscheint.
4. Zum Adel nach links schwenken, zum Volk nach rechts. Dank Gyrosensor bleibt alles 30 Sekunden lang an seinem Platz im Raum, auch wenn der Thermostat nicht mehr im Bild ist. Ohne Gyrosensor verschwindet die Szene, sobald der Thermostat aus dem Bild ist.
5. Mit der freien Hand nach einem Gegenstand greifen oder ihn antippen. Wer nach einem Kopf greift, wechselt den Dichter, und Karte und Buch wechseln mit.

Die Kamera funktioniert nur über https. Eine lokal über das WLAN geöffnete Seite zeigt deshalb eine Fehlermeldung.

## Wie es funktioniert

**Erkennung.** Fertige AR-Bibliotheken wie MindAR suchen nach Bildmustern mit vielen Details. Der Thermostat hat fast keine, MindAR fand ihn nur auf 2 bis 3 von 15 Testfotos. Deshalb sucht `site/detect.js` gezielt nach dem dunklen Display im hellen Gehäuse. Das Programm wandelt jedes Kamerabild in Graustufen um, probiert mehrere Helligkeitsschwellen aus und behält dunkle Rechtecke mit passendem Seitenverhältnis und hellem Rand. Ein Vergleich mit einer gespeicherten Vorlage aus Foto `0442.jpg` sortiert den schwarzen Kartenleser aus, der direkt neben dem Thermostat hängt. Zum Schluss werden die vier Kanten des Displays auf Bruchteile eines Pixels genau gemessen, sonst wackelt die Szene.

**Lage im Raum.** Aus den vier Ecken des Displays und seiner echten Größe von 6,1 × 4,5 cm berechnet `site/pose.js`, wie der Thermostat gedreht ist. Den Abstand nimmt `site/main.js` aus der Länge der senkrechten Display-Kanten, denn auf 2 m ist das Display nur etwa 32 Pixel breit, und die Rechnung über alle vier Ecken wird dann zu ungenau. Der Gyrosensor liefert die Drehung der Kamera. Weil das gezeigte Kamerabild etwa 100 ms älter ist als die neueste Gyro-Messung, merkt sich die App die Messungen der letzten Sekunde und nimmt die vom Aufnahmezeitpunkt des Bildes. So bleibt die Szene beim Schwenken an der Wand stehen.

**Die Szene.** `site/catalog.js` legt fest, welcher Gegenstand wo hängt und wie groß er ist, in Metern ab der Displaymitte. `site/scene.js` lädt die Modelle und zeichnet sie mit three.js, mit Umgebungslicht und Schatten auf der Wand. Die Texte stehen in `site/data/texts.json`, `site/info.js` und `site/ui.js` zeigen sie als Karte neben dem Gegenstand. `site/book.js` baut die Bücher mit den Titelseiten aus `site/img/works`.

**Die Hand.** `site/hands.js` lässt MediaPipe in jedem zweiten Kamerabild nach einer Hand suchen. Aus den Abständen der Fingerspitzen zur Handfläche erkennt es eine Faust oder einen Pinzettengriff. Eine Hand, die schon geschlossen ins Bild kommt, greift nichts, bis sie sich einmal öffnet.

**Die Modelle.** Die Köpfe stammen aus alten Kupferstichen. Ein Bildmodell (Qwen-Image-Edit) macht daraus ein farbiges Porträt mit demselben Gesicht, dann baut TRELLIS.2 daraus eine 3D-Büste. Von Bidermann ist kein Bild überliefert, sein Kopf ist eine Rekonstruktion und in der App so beschriftet. Zehn Gegenstände entstehen genauso aus Fotos, sechs sind fertige Scans von Poly Haven. Die Karten baut `tools/maps/build.mjs` aus OpenStreetMap-Daten und Höhendaten. Woher jedes Bild, Modell und jede Angabe kommt, steht in `site/data/credits/`.

Die Seite lädt nichts von fremden Servern. three.js und MediaPipe liegen als Kopie in `site/vendor`, weil CDNs aus Shanghai oft langsam oder gar nicht erreichbar sind. Eine Content-Security-Policy hindert MediaPipe daran, Nutzungsdaten an Google zu schicken.

## Ordner

```
barock-ar/
  site/         die Webseite, so wie sie online geht
  test/         Testskripte, Fotos vom Thermostat und Handfotos
  tools/        Skripte, die Karten, Modelle, Titelseiten und site/vendor erzeugen
  package.json  Befehle für Tests und Veröffentlichung
```

## Entwicklung

Man braucht Node.js, ffmpeg, Python 3 und Google Chrome.

```sh
cd barock-ar
npm install
npm run vendor      # kopiert three.js und MediaPipe nach site/vendor
cd site && python3 -m http.server 8000 --bind 127.0.0.1
```

Am Computer läuft die Seite dann unter http://localhost:8000. Auf `localhost` erlaubt der Browser die Kamera auch ohne https.

### Tests

Die Tests starten Chrome mit einer künstlichen Kamera, die ein Video aus den Testfotos abspielt. `test:world`, `test:scene` und `test:grab` zeichnen auf dem Mac mit der echten Grafikkarte und öffnen dafür kurz ein Fenster, weil die Software-Grafik für alle Modelle und die Handerkennung zu langsam ist.

| Befehl | prüft |
| --- | --- |
| `npm run test:detect` | Erkennung auf 15 Fotos mit und 8 Fotos ohne Thermostat |
| `npm run test:pose` | Lageberechnung mit erfundenen Ecken, deren Ergebnis bekannt ist |
| `npm run test:jitter` | wie stark die Szene bei wackelnder Kamera zittert |
| `npm run test:world` | ob die Szene beim Schwenken an ihrem Platz im Raum bleibt |
| `npm run test:app` | die ganze Seite von Start bis "GEFUNDEN", mit Screenshots in `test/out` |
| `npm run test:scene` | ein Raum aus 1,8 m Abstand: alle Modelle geladen und sichtbar, Karten nach Tippen und Greifen, Wechsel des Dichters |
| `npm run test:grab` | Greifen mit echten Handfotos über dem Thermostat: genau ein Greifen und ein Loslassen an der richtigen Stelle |
| `npm run test:texts` | alle Texte vorhanden, leicht lesbar (Flesch-Amstad ab 60, kurze Sätze), jeder mit Quelle |
| `npm run test:assets` | jedes Modell unter der Grenze für Handys (Größe, Dreiecke, Texturen) |
| `npm run test:video -- <video>` | Erkennung Bild für Bild in einem echten Handyvideo |

`test:app` prüft mit `APP_URL=https://thermo-blade.netlify.app npm run test:app` auch die Live-Seite.

Das Handyvideo `IMG_0447.MOV`, mit dem die Erkennung aus 1 bis 3 m Entfernung eingestellt wurde, ist nicht im Repo. Darauf sind Mitschüler zu sehen.

### Veröffentlichen

```sh
cd barock-ar
npm run deploy
```

Das lädt den Ordner `site` zu Netlify hoch. Dafür muss die Netlify CLI installiert und angemeldet sein. Modelle, Karten und Handerkennung sind zusammen etwa 50 MB groß, beim ersten Öffnen dauert das Laden deshalb etwas.

## Grenzen

- Die App kennt nur diesen einen Thermostat. Andere Geräte mit dunklem Display im hellen Rahmen kann sie damit verwechseln.
- Die Brennweite der Kamera ist geschätzt. Auf manchen Handys steht die Szene deshalb etwas zu nah oder zu weit weg.
- Ohne Gyrosensor funktioniert die Seite auch, die Szene verschwindet dann aber sofort, sobald der Thermostat aus dem Bild ist.
- Der Gyrosensor misst nur Drehungen. Wer beim Schwenken weit zur Seite geht, verschiebt die Szene, bis die Kamera den Thermostat wieder sieht.
- Greifen und Bildrate sind nur am Computer mit Fotos getestet, noch nicht mit einer echten Hand auf einem echten Handy.
- Die Karten zeigen die Städte von heute, mit einigen modernen Gebäuden. Schnabelmasken gab es in Italien und Frankreich, nicht in Deutschland, das sagt auch der Text dazu.
