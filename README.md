# Barock-Plakat, analog und digital

Dieses Repo gehört zu einer Aufgabe aus dem Deutschunterricht. Wir gestalten ein Plakat zum Barock, und zwar in zwei Versionen. Die analoge Version ist ein echtes Plakat auf Papier. Die digitale Version entsteht hier im Repo. Sie ist eine Augmented-Reality-Webseite fürs Handy, die das Plakat in den Raum erweitert.

Die Webseite heißt **Barock im Raum**. Richtet man die Handykamera auf das Barock-Plakat, erscheint um es herum ein kleines Barock-Museum aus echten 3D-Modellen:

- **In der Mitte drei Dichter:** Johann Valentin Andreae, Jakob Bidermann und Sigmund von Birken als 3D-Köpfe. Unter ihnen liegt das wichtigste Werk des gerade gewählten Dichters als Buch mit der echten Titelseite. Daneben steht eine 3D-Karte seiner Stadt, auf der sich etwas bewegt: Flöße auf dem Neckar in Tübingen, eine Prozession an St. Michael in München, eine Schafherde auf der Hallerwiese in Nürnberg.
- **Links der Adel:** Krone, Schloss, Perücke, Kutsche, Degen, Spiegel, Kronleuchter und Pokal.
- **Rechts das Volk:** Bauernhaus, Pflug, Sense, Brot, Pestmaske, Soldatenhelm, Fass und Spinnrad.

Man greift mit der Hand in das Kamerabild und schließt sie über einem Gegenstand zur Faust. Dann kommt der Gegenstand nach vorne, und daneben erscheint ein kurzer Text in einfacher Sprache. Antippen geht auch.

Die alte Version mit dem Pixel-Schwert heißt Thermo Blade und liegt noch unter https://thermo-blade.netlify.app.

## Benutzung

1. Die Seite auf dem Handy öffnen. Gedacht ist sie für Safari auf dem iPhone, Chrome auf Android sollte auch gehen.
2. START tippen und Kamera und Bewegungssensoren erlauben.
3. Die Kamera auf das Barock-Plakat richten. Sobald es erkannt ist, steht unten "GEFUNDEN" und die Szene erscheint.
4. Zum Adel nach links schwenken, zum Volk nach rechts. Dank Gyrosensor bleibt alles 30 Sekunden lang an seinem Platz im Raum, auch wenn das Plakat nicht mehr im Bild ist. Ohne Gyrosensor verschwindet die Szene kurz nach einem verlorenen Bildziel.
5. Mit der freien Hand nach einem Gegenstand greifen oder ihn antippen. Wer nach einem Kopf greift, wechselt den Dichter, und Karte und Buch wechseln mit.

Die Kamera funktioniert nur über https oder auf localhost.

## Wie es funktioniert

**Erkennung.** `site/poster.js` steuert MindAR 1.2.5. Die Bibliothek sucht nach Bildmerkmalen im gesamten gelieferten Plakat. Ein Treffer zählt nur, wenn seine Merkmale mindestens 30 Prozent der Plakatbreite oder 28 Prozent der Plakathöhe abdecken. Der kompilierte Bildmarker liegt in `site/targets/poster.mind`, das unveränderte Ausgangsbild in `site/img/poster.png`.

**Lage im Raum.** Aus den erkannten Merkmalen berechnet MindAR die Lage des Plakats. `site/poster.js` setzt dieselbe Brennweite wie die three.js-Kamera und wandelt das Ergebnis in eine Pose um deren Mittelpunkt und Maßeinheiten stimmen. Als Druckgröße ist A1 quer mit 84,1 cm Breite eingestellt, was vier A3-Seiten entspricht. Der Gyrosensor liefert die Drehung der Kamera. Weil das gezeigte Kamerabild älter sein kann als die neueste Gyro-Messung, merkt sich die App die Messungen der letzten Sekunde und nimmt die vom Aufnahmezeitpunkt des Bildes. Erkennung und Hintergrundbild stammen immer aus demselben Kamerabild.

**Die Szene.** `site/catalog.js` legt fest, welcher Gegenstand wo hängt und wie groß er ist, in Metern ab der Plakatmitte. `site/scene.js` lädt die Modelle und zeichnet sie mit three.js, mit Umgebungslicht und Schatten. Die Texte stehen in `site/data/texts.json`, `site/info.js` und `site/ui.js` zeigen sie als Karte neben dem Gegenstand. `site/book.js` baut die Bücher mit den Titelseiten aus `site/img/works`.

**Die Hand.** `site/hands.js` lässt MediaPipe in jedem zweiten Kamerabild nach einer Hand suchen. Aus den Abständen der Fingerspitzen zur Handfläche erkennt es eine Faust oder einen Pinzettengriff. Eine Hand, die schon geschlossen ins Bild kommt, greift nichts, bis sie sich einmal öffnet.

**Die Modelle.** Die Köpfe stammen aus alten Kupferstichen. Ein Bildmodell (Qwen-Image-Edit) macht daraus ein farbiges Porträt mit demselben Gesicht, dann baut TRELLIS.2 daraus eine 3D-Büste. Von Bidermann ist kein Bild überliefert, sein Kopf ist eine Rekonstruktion und in der App so beschriftet. Zehn Gegenstände entstehen genauso aus Fotos, sechs sind fertige Scans von Poly Haven. Die Karten baut `tools/maps/build.mjs` aus OpenStreetMap-Daten und Höhendaten. Woher jedes Bild, Modell und jede Angabe kommt, steht in `site/data/credits/`.

Die Seite lädt nichts von fremden Servern. three.js, MindAR und MediaPipe liegen als Kopie in `site/vendor`, weil CDNs aus Shanghai oft langsam oder gar nicht erreichbar sind. Eine Content-Security-Policy beschränkt Netzwerkzugriffe auf die eigene Seite.

## Ordner

```
barock-ar/
  site/         die Webseite, so wie sie online geht
  test/         Testskripte und Testfotos
  tools/        Skripte für Bildmarker, Karten, Modelle und site/vendor
  package.json  Befehle für Tests und Veröffentlichung
```

## Entwicklung

Man braucht Node.js, ffmpeg, Python 3 und Google Chrome.

```sh
cd barock-ar
npm install
npm run vendor      # kopiert three.js, MindAR und MediaPipe nach site/vendor
npm run target      # kompiliert site/img/poster.png nach site/targets/poster.mind
cd site && python3 -m http.server 8000 --bind 127.0.0.1
```

Am Computer läuft die Seite dann unter http://localhost:8000. Auf `localhost` erlaubt der Browser die Kamera auch ohne https. `npm run target` ist nur nach einer Änderung am Plakat nötig.

### Tests

Die Browsertests starten Chrome mit einer künstlichen Kamera. `test:world`, `test:scene`, `test:grab`, `test:steady` und `test:upgrades` zeichnen auf dem Mac mit der echten Grafikkarte und öffnen dafür kurz ein Fenster.

| Befehl | prüft |
| --- | --- |
| `npm run test:detect` | zehn Plakatansichten mit höchstens 20 px Eckfehler, 25 px bei Unschärfe, abgelehnte Fotos des alten Plakats, Fremdbilder und Ausschnitte, Verlust und Wiederfinden |
| `npm run test:pose` | Kameraparameter und Umrechnung in eine mittige Pose in Metern |
| `npm run test:jitter` | wie stark die Szene bei wackelnder Kamera zittert |
| `npm run test:steady` | Positions- und Rotationsjitter, Sichtbarkeit und Sprünge beim Wiederfinden; `--no-gyro` prüft den Betrieb ohne Bewegungssensoren |
| `npm run test:world` | Bildsynchronität, 20 px im sichtbaren Bereich, 30 px bei Abdeckung, 70 px bei gyrogestütztem Halten außerhalb des Bildes |
| `npm run test:app` | die ganze Seite von Start bis "GEFUNDEN", mit Screenshots in `test/out` |
| `npm run test:scene` | alle Modelle, Karten nach Tippen und Greifen, Wechsel des Dichters |
| `npm run test:grab` | Greifen und Loslassen an der richtigen Stelle, dazu drei Faustwechsel in der ganzen Seite bei gedrosselter CPU ohne Gyrosensor |
| `npm run test:upgrades` | drei echte 3D-Vorschauen, Wechsel und Drehen |
| `npm run test:texts` | alle Texte vorhanden, leicht lesbar, jeder mit Quelle |
| `npm run test:assets` | jedes Modell unter der Grenze für Handys |

### Veröffentlichen

```sh
cd barock-ar
npm run deploy
```

Die öffentliche Seite ist https://barock-im-raum.pages.dev. Das lädt den Ordner `site` zum gleichnamigen Cloudflare-Pages-Projekt hoch. Für die Anmeldung reicht `npx wrangler login --device` und ein Cloudflare-Konto. Modelle, Karten und Handerkennung sind zusammen etwa 50 MB groß, beim ersten Öffnen dauert das Laden deshalb etwas.

## Grenzen

- Die Plakaterkennung kennt nur dieses eine Plakat. Der Ausdruck muss dem Bild in `site/img/poster.png` entsprechen.
- Als Druckgröße ist A1 quer mit 84,1 cm Breite eingestellt, was vier A3-Seiten entspricht. Eine andere Größe verändert den berechneten Abstand und die Skala der Szene.
- Die Brennweite der Kamera ist geschätzt. Auf manchen Handys steht die Szene deshalb etwas zu nah oder zu weit weg.
- Ohne Gyrosensor funktioniert die Seite auch, die Szene verschwindet dann kurz nach einem verlorenen Bildziel.
- Der Gyrosensor misst nur Drehungen. Wer beim Schwenken weit zur Seite geht, verschiebt die Szene, bis die Kamera das Plakat wieder sieht.
- Greifen und Bildrate sind am Computer mit Testbildern geprüft. Ein echtes Plakat auf einem echten Handy steht noch aus.
- Die Karten zeigen die Städte von heute, mit einigen modernen Gebäuden. Schnabelmasken gab es in Italien und Frankreich, nicht in Deutschland, das sagt auch der Text dazu.
