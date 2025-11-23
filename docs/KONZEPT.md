# Konzept: Veranstaltungsortbezogene Dienstplanung

**Version:** 1.0  
**Datum:** 2025-11-22  
**Autor:** bwl21 / Ona  
**Basierend auf:** VeranstaltungsOrtbezogene_Dienstplanung.md

---

## 1. Executive Summary

Die Extension "bwl_dienstplanung" erweitert ChurchTools um ein umfassendes Dienstplanungssystem mit Disponent-Funktion. Sie ermöglicht die koordinierte Planung von Diensten über mehrere Veranstaltungsräume hinweg, berücksichtigt Mitarbeiterverfügbarkeiten und unterstützt einen Disponenten bei der optimalen Zuweisung von Mitarbeitern zu Dienstanforderungen.

### Kernfunktionen
1. **Mitarbeiter-Verfügbarkeitsmeldung** - Mitarbeiter melden ihre Verfügbarkeit für alle anstehenden Veranstaltungen
2. **Disponent-Ansicht** - Zentrale Übersicht aller Veranstaltungen, Dienstanforderungen und Verfügbarkeiten
3. **Intelligente Zuweisung** - Berücksichtigung von Schwerpunkten, Räumen und ausgewogener Auslastung
4. **Veranstaltungsraumbasiert** - Unterstützung mehrerer Räume mit spezifischen Anforderungen

---

## 2. Problemstellung & Anforderungen

### 2.1 Ausgangssituation

**Akteure:**
- **Veranstalter** - Planen Veranstaltungen und fordern Dienste an
- **Mitarbeiter** - Führen Dienste aus, haben Schwerpunkte (Fähigkeiten, Räume, Zeiten)
- **Disponent** - Koordiniert die Zuweisung von Mitarbeitern zu Dienstanforderungen

**Herausforderungen:**
- Veranstaltungen in verschiedenen Räumen
- Mitarbeiter mit unterschiedlichen Schwerpunkten (Funktion, Raum, Zeit)
- Notwendigkeit der Verfügbarkeitsmeldung vor Zuweisung
- Ausgewogene Auslastung der Mitarbeiter
- Flexibilität bei Raumverlegungen (Edge Case)

### 2.2 Prozessübersicht

```
1. Veranstalter → Veranstaltung mit Dienstanforderungen erstellen
2. System → Veranstaltungsliste für Mitarbeiter bereitstellen
3. Mitarbeiter → Verfügbarkeit für mögliche Einsätze melden
4. Disponent → Mitarbeiter zu konkreten Dienstanforderungen zuweisen
5. System → Mitarbeiter über Einsatz informieren
```

### 2.3 Statusmodell

**Verfügbarkeitsstatus (Mitarbeiter-Sicht):**
- 🟢 **Bereit** (Grün) - Mitarbeiter kann und möchte den Dienst übernehmen
- 🟡 **Vielleicht** (Gelb) - Mitarbeiter könnte eventuell, unsicher
- 🔴 **Nicht bereit** (Rot) - Mitarbeiter kann nicht oder möchte nicht
- ⚫ **Abwesend** (Rot mit Icon) - Mitarbeiter ist nicht verfügbar (Urlaub, etc.)

**Zuweisungsstatus (Disponent-Sicht):**
- 🔵 **Zugeteilt** (Blau) - Mitarbeiter wurde vom Disponenten zugewiesen
- 🔘 **Extern** (Icon) - Person außerhalb ChurchTools
- 🔘 **Außerhalb Gruppe** (Icon) - Person außerhalb der Dienstbesetzergruppe

---

## 3. Architektur & Datenmodell

### 3.1 ChurchTools Integration

**Genutzte ChurchTools-Entitäten:**
- **Events** (`/api/events`) - Veranstaltungen mit Datum, Raum, Dienstanforderungen
- **Services** (`/api/services`) - Dienste innerhalb von Dienstkategorien
- **Service Groups** (`/api/event/servicegroups`) - Dienstkategorien (z.B. "EG Technik")
- **Persons** (`/api/persons`) - Mitarbeiter mit Gruppenzugehörigkeit
- **Groups** (`/api/groups`) - Dienstbesetzergruppen mit Schwerpunkten
- **Resources** - Räume und Ressourcen für Veranstaltungen

### 3.2 Extension-Datenmodell (Key-Value Store)

#### Settings (Kategorie: `settings`)
```typescript
interface DienstplanungSettings {
  serviceCategoryId: string;           // Ausgewählte Dienstkategorie
  availabilityRequestDays: number;     // Tage im Voraus für Verfügbarkeitsanfrage
  reminderDays: number[];              // Erinnerungstage vor Veranstaltung
  displayRooms: string[];              // Anzuzeigende Räume (Filter)
}
```

#### Availabilities (Kategorie: `availabilities`)
```typescript
interface Availability {
  eventId: number;                     // Veranstaltungs-ID
  serviceId: number;                   // Dienst-ID
  userId: number;                      // Mitarbeiter-ID
  status: 'yes' | 'maybe' | 'no' | 'absent';  // Verfügbarkeitsstatus
  timestamp: string;                   // Zeitpunkt der Meldung
  comment?: string;                    // Optional: Kommentar
}
```

#### Assignments (Kategorie: `assignments`)
```typescript
interface Assignment {
  eventId: number;                     // Veranstaltungs-ID
  serviceId: number;                   // Dienst-ID
  userId: number;                      // Zugewiesener Mitarbeiter
  assignedBy: number;                  // Disponent (User-ID)
  assignedAt: string;                  // Zeitpunkt der Zuweisung
  status: 'assigned' | 'confirmed' | 'declined';  // Zuweisungsstatus
  isExternal: boolean;                 // Externe Person
  externalName?: string;               // Name bei externer Person
}
```

#### WorkloadTracking (Kategorie: `workload`)
```typescript
interface WorkloadEntry {
  userId: number;                      // Mitarbeiter-ID
  period: string;                      // Zeitraum (z.B. "2025-Q1")
  assignmentCount: number;             // Anzahl Zuweisungen
  totalHours: number;                  // Geschätzte Gesamtstunden
  lastUpdated: string;                 // Letztes Update
}
```

### 3.3 Schwerpunkte & Präferenzen

**Aus ChurchTools-Gruppen:**
- Gruppenzugehörigkeit → Fähigkeiten/Funktionen
- Gruppen-Tags → Raumschwerpunkte (z.B. "EG GZ", "EG GS")
- Gruppen-Rollen → Erfahrungslevel

**Zusätzlich in Extension:**
- Zeitpräferenzen (Wochentage, Uhrzeiten)
- Maximale Einsätze pro Monat/Quartal
- Bevorzugte Dienste

---

## 4. UI/UX-Konzept

### 4.1 Extension Points

#### 4.1.1 Admin-Panel (`admin`)
**Zweck:** Konfiguration der Extension

**Funktionen:**
- Auswahl der Dienstkategorie(n)
- Konfiguration der Verfügbarkeitsanfrage (Vorlaufzeit)
- Erinnerungseinstellungen
- Raumfilter konfigurieren
- Berechtigungen für Disponenten verwalten

#### 4.1.2 Mitarbeiter-Ansicht (`main`)
**Zweck:** Verfügbarkeitsmeldung durch Mitarbeiter

**Layout:**
```
┌─────────────────────────────────────────────────────────┐
│ Dienstplanung - Meine Verfügbarkeit                     │
├─────────────────────────────────────────────────────────┤
│ Filter: [Alle Räume ▼] [Nächste 30 Tage ▼]             │
├─────────────────────────────────────────────────────────┤
│                                                          │
│ ┌─ Sonntag, 24.11.2025 10:00 - Gottesdienst EG ──────┐ │
│ │ 📍 EG Gemeindesaal                                   │ │
│ │                                                      │ │
│ │ ┌─ Ton ─────────────────────────────────────────┐   │ │
│ │ │ [🟢 Ja] [🟡 Vielleicht] [🔴 Nein]            │   │ │
│ │ └──────────────────────────────────────────────┘   │ │
│ │                                                      │ │
│ │ ┌─ Präsentation ────────────────────────────────┐   │ │
│ │ │ [🟢 Ja] [🟡 Vielleicht] [🔴 Nein]            │   │ │
│ │ └──────────────────────────────────────────────┘   │ │
│ └──────────────────────────────────────────────────┘ │
│                                                          │
│ ┌─ Mittwoch, 27.11.2025 19:30 - Jugendgottesdienst ─┐ │
│ │ 📍 EG Gemeindesaal                                   │ │
│ │ ...                                                  │ │
│ └──────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

**Features:**
- Chronologische Liste aller Veranstaltungen
- Gruppierung nach Datum
- Farbcodierte Buttons für Verfügbarkeitsstatus
- Anzeige bereits gemeldeter Verfügbarkeiten
- Anzeige von Zuweisungen (blau markiert)
- Kommentarfeld für Anmerkungen

#### 4.1.3 Disponent-Ansicht (Neuer Extension Point)
**Zweck:** Zentrale Zuweisung durch Disponenten

**Layout:**
```
┌─────────────────────────────────────────────────────────────────────┐
│ Dienstplanung - Disponent                                           │
├─────────────────────────────────────────────────────────────────────┤
│ Filter: [Dienst: Ton ▼] [Raum: Alle ▼] [Zeitraum: Nächste 4 Wochen]│
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│ ┌─ Sonntag, 24.11.2025 10:00 - Gottesdienst EG ─────────────────┐  │
│ │ 📍 EG Gemeindesaal                                              │  │
│ │                                                                 │  │
│ │ Dienst: Ton                                                     │  │
│ │ ┌─────────────────────────────────────────────────────────┐    │  │
│ │ │ Verfügbar (3):                                          │    │  │
│ │ │ • 🟢 Max Mustermann (Schwerpunkt: EG GZ, Auslastung: 2)│    │  │
│ │ │ • 🟢 Anna Schmidt (Schwerpunkt: EG GS, Auslastung: 4)  │    │  │
│ │ │ • 🟡 Tom Weber (Schwerpunkt: EG GZ, Auslastung: 3)     │    │  │
│ │ │                                                          │    │  │
│ │ │ Nicht verfügbar (2):                                    │    │  │
│ │ │ • 🔴 Lisa Müller (Grund: Urlaub)                        │    │  │
│ │ │ • 🔴 Peter Klein                                        │    │  │
│ │ │                                                          │    │  │
│ │ │ Zugewiesen: [Max Mustermann ▼] [Zuweisen]              │    │  │
│ │ └─────────────────────────────────────────────────────────┘    │  │
│ └─────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

**Features:**
- Übersicht aller Veranstaltungen mit Dienstanforderungen
- Anzeige aller Verfügbarkeitsmeldungen pro Dienst
- Sortierung nach Verfügbarkeit (Grün → Gelb → Rot)
- Anzeige von Schwerpunkten und aktueller Auslastung
- Hover-Tooltip mit detaillierten Mitarbeiterinformationen
- Drag & Drop für Zuweisung
- Externe Personen hinzufügen
- Auslastungsbalance-Indikator

#### 4.1.4 Statistik-Ansicht (Optional)
**Zweck:** Übersicht über Auslastung und Trends

**Features:**
- Auslastung pro Mitarbeiter (Balkendiagramm)
- Verfügbarkeitsquoten
- Häufigste Absagen/Zusagen
- Zeitliche Trends

### 4.2 Interaktionskonzept

#### Mitarbeiter-Workflow
1. Mitarbeiter öffnet Extension
2. Sieht Liste aller anstehenden Veranstaltungen
3. Klickt auf Verfügbarkeitsstatus (Ja/Vielleicht/Nein)
4. Status wird sofort gespeichert und visuell bestätigt
5. Bei Zuweisung durch Disponent: Status wechselt zu "Zugeteilt" (blau)

#### Disponent-Workflow
1. Disponent öffnet Disponent-Ansicht
2. Filtert nach Dienst, Raum oder Zeitraum
3. Sieht für jede Dienstanforderung:
   - Verfügbare Mitarbeiter (grün/gelb)
   - Nicht verfügbare Mitarbeiter (rot)
   - Schwerpunkte und Auslastung
4. Wählt Mitarbeiter aus Dropdown oder per Drag & Drop
5. Klickt "Zuweisen"
6. System speichert Zuweisung und informiert Mitarbeiter

#### Intelligente Vorschläge
- System schlägt Mitarbeiter vor basierend auf:
  - Verfügbarkeit (grün bevorzugt)
  - Schwerpunkte (Raum, Funktion)
  - Auslastung (niedrige bevorzugt)
  - Letzte Einsätze (Rotation)

---

## 5. Implementierungsphasen

### Phase 1: Basis-Funktionalität (Aktuell implementiert) ✅
- [x] Admin-Panel: Dienstkategorie-Auswahl
- [x] Mitarbeiter-Ansicht: Event-Liste
- [x] Verfügbarkeitsmeldung (Ja/Vielleicht/Nein)
- [x] Key-Value Store Integration
- [x] Basis-UI mit Farbcodierung

### Phase 2: Disponent-Funktionalität
- [ ] Neuer Extension Point für Disponent-Ansicht
- [ ] Verfügbarkeitsübersicht pro Dienst
- [ ] Zuweisungsfunktion
- [ ] Externe Personen hinzufügen
- [ ] Benachrichtigungen bei Zuweisung

### Phase 3: Schwerpunkte & Intelligenz
- [ ] Schwerpunkte aus ChurchTools-Gruppen laden
- [ ] Schwerpunkte in Extension konfigurieren
- [ ] Auslastungsberechnung
- [ ] Intelligente Vorschläge für Zuweisung
- [ ] Hover-Tooltips mit Mitarbeiterdetails

### Phase 4: Erweiterte Features
- [ ] Raumfilter und Raumverlegung
- [ ] Zeitpräferenzen
- [ ] Erinnerungsfunktion
- [ ] Statistik-Ansicht
- [ ] Export-Funktionen (PDF, Excel)
- [ ] Quartalstreffen-Modus

### Phase 5: Optimierung & Skalierung
- [ ] Performance-Optimierung für große Datenmengen
- [ ] Caching-Strategien
- [ ] Offline-Fähigkeit
- [ ] Mobile-Optimierung
- [ ] Mehrsprachigkeit

---

## 6. Technische Anforderungen

### 6.1 ChurchTools API-Endpunkte

**Benötigt:**
- `GET /api/events` - Events mit Dienstanforderungen
- `GET /api/services` - Dienste
- `GET /api/event/servicegroups` - Dienstkategorien
- `GET /api/persons` - Mitarbeiter
- `GET /api/groups` - Dienstbesetzergruppen
- `GET /api/resources` - Räume und Ressourcen
- `GET /api/event/{id}/services` - Dienste eines Events
- `POST /api/event/{id}/services/{serviceId}/bookings` - Zuweisung (falls verfügbar)

**Optional/Erweiterung:**
- Benachrichtigungs-API für Mitarbeiter-Informationen
- Webhook für Event-Änderungen

### 6.2 Berechtigungen

**Mitarbeiter:**
- `churchcal view` - Events sehen
- `churchservice view` - Dienste sehen
- Extension-Zugriff auf eigene Verfügbarkeiten

**Disponent:**
- Alle Mitarbeiter-Berechtigungen
- `churchservice edit` - Dienste zuweisen
- Extension-Zugriff auf alle Verfügbarkeiten
- Extension-Zugriff auf Zuweisungsfunktion

**Admin:**
- Alle Disponent-Berechtigungen
- Extension-Konfiguration

### 6.3 Performance-Überlegungen

**Caching:**
- Events: 5 Minuten Cache
- Services: 15 Minuten Cache
- Verfügbarkeiten: Kein Cache (Echtzeit)
- Zuweisungen: Kein Cache (Echtzeit)

**Pagination:**
- Events: Max 100 pro Anfrage
- Mitarbeiter: Max 50 pro Dienst anzeigen

**Lazy Loading:**
- Verfügbarkeiten erst bei Bedarf laden
- Mitarbeiterdetails erst bei Hover laden

---

## 7. Offene Fragen & Entscheidungen

### 7.1 Technisch
- [ ] Wie werden externe Personen in ChurchTools abgebildet?
- [ ] Gibt es eine API für Dienstzuweisungen oder muss dies über Extension erfolgen?
- [ ] Wie werden Benachrichtigungen an Mitarbeiter gesendet?
- [ ] Soll die Extension auch ChurchTools-Dienste direkt buchen können?

### 7.2 Fachlich
- [ ] Wie wird "Auslastung" genau berechnet? (Anzahl Dienste, Stunden, gewichtet?)
- [ ] Welche Schwerpunkte sind relevant? (Raum, Funktion, Zeit, Erfahrung?)
- [ ] Wie wird mit Konflikten umgegangen? (Mehrfachzuweisung, Überlappungen)
- [ ] Soll es eine Bestätigungspflicht für Mitarbeiter geben?

### 7.3 Prozess
- [ ] Wer darf Disponenten-Rechte vergeben?
- [ ] Wie läuft der Quartalstreffen-Prozess ab?
- [ ] Wie werden Mitarbeiter über neue Verfügbarkeitsanfragen informiert?
- [ ] Gibt es Deadlines für Verfügbarkeitsmeldungen?

---

## 8. Risiken & Mitigationen

| Risiko | Wahrscheinlichkeit | Impact | Mitigation |
|--------|-------------------|--------|------------|
| ChurchTools API-Limitierungen | Mittel | Hoch | Caching, Batch-Requests, Fallback-Strategien |
| Performance bei vielen Events | Mittel | Mittel | Pagination, Lazy Loading, Filterung |
| Komplexität der Zuweisung | Hoch | Mittel | Schrittweise Implementierung, User-Feedback |
| Berechtigungskonzept | Niedrig | Hoch | Frühe Klärung mit ChurchTools-Admins |
| Dateninkonsistenzen | Mittel | Hoch | Validierung, Konfliktauflösung, Logging |

---

## 9. Erfolgsmetriken

**Quantitativ:**
- Anzahl Verfügbarkeitsmeldungen pro Veranstaltung
- Zeit für Dienstplanung (vorher/nachher)
- Anzahl Zuweisungen pro Disponent-Session
- Auslastungsverteilung (Standardabweichung)

**Qualitativ:**
- Zufriedenheit der Mitarbeiter (Umfrage)
- Zufriedenheit der Disponenten (Umfrage)
- Reduzierung von Planungskonflikten
- Verbesserung der Kommunikation

---

## 10. Nächste Schritte

1. **Feedback einholen** - Konzept mit Stakeholdern besprechen
2. **Offene Fragen klären** - Technische und fachliche Entscheidungen treffen
3. **Phase 2 planen** - Disponent-Ansicht detailliert spezifizieren
4. **Prototyp erstellen** - Disponent-UI als Mockup
5. **API-Tests** - ChurchTools API-Endpunkte testen
6. **Berechtigungskonzept** - Mit ChurchTools-Admins abstimmen

---

## Anhang

### A. Glossar

- **Disponent** - Person, die Mitarbeiter zu Dienstanforderungen zuweist
- **Dienstbesetzergruppe** - ChurchTools-Gruppe mit Mitarbeitern für bestimmte Dienste
- **Dienstkategorie** - Gruppe von Diensten (z.B. "EG Technik")
- **Schwerpunkt** - Präferenz oder Fähigkeit eines Mitarbeiters (Raum, Funktion, Zeit)
- **Verfügbarkeit** - Meldung eines Mitarbeiters, ob er für einen Dienst zur Verfügung steht
- **Zuweisung** - Konkrete Zuordnung eines Mitarbeiters zu einer Dienstanforderung
- **Auslastung** - Anzahl/Umfang der Dienste eines Mitarbeiters in einem Zeitraum

### B. Referenzen

- [ChurchTools API Dokumentation](https://api.church.tools/)
- [Extension Boilerplate](https://github.com/churchtools/extension-boilerplate)
- [VeranstaltungsOrtbezogene_Dienstplanung.md](./VeranstaltungsOrtbezogene_Dienstplanung.md)

### C. Änderungshistorie

| Version | Datum | Autor | Änderungen |
|---------|-------|-------|------------|
| 1.0 | 2025-11-22 | bwl21/Ona | Initiales Konzept basierend auf Anforderungsdokument |

