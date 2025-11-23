# Testing Guide - Dienstplanung Extension

## Phase 2: Disponent-Funktionalität

### Neue Features
- ✅ Disponent-Ansicht mit Verfügbarkeitsübersicht
- ✅ Zuweisungsfunktion für Mitarbeiter
- ✅ Auslastungsanzeige pro Mitarbeiter
- ✅ Filter nach Dienst und Zeitraum

### Test-Szenarien

#### 1. Admin-Panel testen
1. Öffne die Extension im Browser
2. Navigiere zu "Dienstplanung Einstellungen" (Admin)
3. Wähle eine Dienstkategorie aus
4. Speichere die Einstellungen
5. ✅ Erfolgsmeldung sollte erscheinen
6. ✅ Berechtigungen-Info sollte sichtbar sein

#### 2. Mitarbeiter-Ansicht testen
1. Navigiere zu "Dienstplanung" (Mitarbeiter-Ansicht)
2. ✅ Liste der anstehenden Events sollte erscheinen
3. ✅ Dienste der konfigurierten Kategorie sollten angezeigt werden
4. Klicke auf Verfügbarkeitsstatus (Ja/Vielleicht/Nein)
5. ✅ Status sollte sofort gespeichert und visuell bestätigt werden
6. ✅ Button sollte farblich markiert sein

#### 3. Disponent-Ansicht testen
1. Navigiere zu "Dienstplanung Disponent"
2. ✅ Liste der Events mit Dienstanforderungen sollte erscheinen
3. ✅ Für jeden Dienst sollten Verfügbarkeiten angezeigt werden:
   - 🟢 Verfügbar (grün)
   - 🟡 Vielleicht (gelb)
   - 🔴 Nicht verfügbar (rot)
4. ✅ Auslastung pro Mitarbeiter sollte angezeigt werden
5. Wähle einen Mitarbeiter aus dem Dropdown
6. Klicke "Zuweisen"
7. ✅ Zuweisung sollte gespeichert werden
8. ✅ Zugewiesener Mitarbeiter sollte blau markiert sein

#### 4. Filter testen
1. In der Disponent-Ansicht:
2. Wähle einen spezifischen Dienst aus dem Filter
3. ✅ Nur Events mit diesem Dienst sollten angezeigt werden
4. Ändere den Zeitraum-Filter
5. ✅ Events sollten entsprechend gefiltert werden

#### 5. Auslastung testen
1. Weise mehrere Dienste demselben Mitarbeiter zu
2. ✅ Auslastungszahl sollte sich erhöhen
3. ✅ Mitarbeiter mit niedriger Auslastung sollten bevorzugt angezeigt werden

### Bekannte Einschränkungen

- Externe Personen können noch nicht hinzugefügt werden (Phase 2 Feature)
- Benachrichtigungen werden noch nicht versendet (Phase 2 Feature)
- Schwerpunkte werden noch nicht berücksichtigt (Phase 3 Feature)
- Intelligente Vorschläge fehlen noch (Phase 3 Feature)

### Debugging

**Browser Console öffnen:**
- Chrome/Edge: F12 oder Rechtsklick → "Untersuchen"
- Firefox: F12 oder Rechtsklick → "Element untersuchen"

**Log-Ausgaben:**
- `[Dienstplanung]` - Mitarbeiter-Ansicht
- `[Disponent]` - Disponent-Ansicht
- `[Admin]` - Admin-Panel

**Häufige Probleme:**

1. **"Keine Dienstkategorie konfiguriert"**
   - Lösung: Admin-Panel öffnen und Dienstkategorie auswählen

2. **"Keine Events gefunden"**
   - Lösung: Prüfen ob Events in ChurchTools existieren
   - Prüfen ob Zeitraum korrekt ist

3. **"Keine Dienste gefunden"**
   - Lösung: Prüfen ob Dienste in der ausgewählten Kategorie existieren

4. **Verfügbarkeiten werden nicht angezeigt**
   - Lösung: Erst als Mitarbeiter Verfügbarkeiten melden
   - Dann als Disponent die Ansicht öffnen

### API-Endpunkte

Die Extension nutzt folgende ChurchTools API-Endpunkte:

- `GET /api/events` - Events laden
- `GET /api/services` - Dienste laden
- `GET /api/event/servicegroups` - Dienstkategorien laden
- `GET /api/persons` - Mitarbeiter laden

### Key-Value Store

Die Extension speichert Daten in folgenden Kategorien:

- `settings` - Konfiguration (Dienstkategorie)
- `availabilities` - Verfügbarkeitsmeldungen
- `assignments` - Zuweisungen durch Disponenten

### Nächste Schritte

Nach erfolgreichem Test von Phase 2:
- [ ] Phase 3: Schwerpunkte & Intelligenz
- [ ] Phase 4: Erweiterte Features
- [ ] Phase 5: Optimierung & Skalierung

