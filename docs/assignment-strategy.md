# Dienstplanungs-Strategie

## Problemstellung

Die Extension muss Personen zu Diensten zuweisen können. Aktuell werden Daten nur gelesen, keine Zuweisungen geschrieben.

**Zentrale Frage:** Wo und wie werden Dienstzuweisungen gespeichert?

---

## Datenstrukturen

### ChurchTools EventService
```typescript
interface EventService {
    id: number;
    serviceId: number;
    personId: number | null;  // Die tatsächliche Zuweisung
    isAccepted: boolean;       // Status der Zuweisung
}
```

### Custom Data Assignment
```typescript
interface Assignment {
    eventId: number;
    serviceId: number;
    userId: number | null;           // null = Dienst soll frei bleiben
    assignedBy: number;
    assignedAt: string;
    status: 'assigned' | 'confirmed' | 'declined';
    isExternal: boolean;
    externalName?: string;
    publishedAt?: string;            // Wann wurde nach CT geschrieben
    publishedPersonId?: number | null; // Was wurde nach CT geschrieben
}
```

**Felder-Erklärung:**
- `userId`: Geplante Person (null = Dienst frei lassen)
- `assignedBy`: Wer hat die Planung gemacht
- `assignedAt`: Wann wurde geplant
- `status`: Workflow-Status (für spätere Erweiterungen)
- `isExternal`: Person nicht in ChurchTools
- `externalName`: Name für externe Personen
- `publishedAt`: Zeitstempel des letzten Publish
- `publishedPersonId`: Was beim letzten Publish geschrieben wurde (für Änderungs-Erkennung)

### Custom Data Availability
```typescript
interface Availability {
    eventId: number;
    serviceId: number;
    userId: number;
    status: 'yes' | 'maybe' | 'no' | 'absent';
    timestamp: string;
    comment?: string;
}
```

---

## Option 1: Zwei-Phasen-Ansatz

### Konzept
Trennung zwischen Planung (Custom Data) und Veröffentlichung (ChurchTools).

### Workflow
```
1. Planung (Custom Data)
   └─> Disponent weist Personen zu
   └─> Speichert in Assignment Custom Data
   └─> Status: "assigned"
   └─> Keine Änderung in ChurchTools

2. Bestätigung (Optional)
   └─> Person wird benachrichtigt
   └─> Kann bestätigen/ablehnen
   └─> Status: "confirmed" / "declined"

3. Überprüfung
   └─> Disponent sieht alle Assignments
   └─> Kann ändern/löschen
   └─> Mehrere Szenarien möglich

4. Veröffentlichung
   └─> "Publish"-Button
   └─> Schreibt nach ChurchTools EventServices
   └─> Sendet finale Benachrichtigungen
   └─> Markiert Assignments als "published"
```

### Vorteile
- ✅ Sicheres Testen ohne Live-Änderungen
- ✅ Undo/Redo möglich
- ✅ Mehrere Disponenten können parallel planen
- ✅ Klare Trennung: Planung vs. Veröffentlichung
- ✅ Experimentieren mit verschiedenen Szenarien
- ✅ Keine versehentlichen Benachrichtigungen

### Nachteile
- ❌ **Daten-Duplikation:** Zwei Datenquellen (Custom Data + ChurchTools)
- ❌ **Synchronisationsprobleme:**
  - Was wenn jemand direkt in ChurchTools zuweist?
  - Was wenn Event gelöscht wird, aber Assignments existieren?
  - Welche Quelle ist "wahr" vor dem Publish?
- ❌ **Komplexität:** Mehr Code, komplexere Fehlerbehandlung
- ❌ **Benutzer-Verwirrung:** Konzept "Draft vs. Published" muss verstanden werden
- ❌ **Benachrichtigungs-Probleme:** Wann benachrichtigen? Doppelte Benachrichtigungen?
- ❌ **Berechtigungen:** Wer darf publishen? Konflikte zwischen Disponenten?
- ❌ **ChurchTools-Integration:** Andere Features sehen nur published Daten
- ❌ **Daten-Inkonsistenz:** Publish-Fehler, Rollback-Strategie nötig
- ❌ **Performance:** Viele API-Calls beim Publish, Rate-Limiting möglich

### Implementierung (vereinfacht)
```typescript
// 1. Assignment erstellen
async function assignPerson(eventId, serviceId, personId) {
    await createCustomDataValue({
        eventId,
        serviceId,
        userId: personId,
        assignedBy: currentUser.id,
        assignedAt: new Date().toISOString(),
        status: 'assigned',
        isExternal: false
    });
}

// 2. Publish (vereinfacht - siehe detaillierte Version unten)
async function publishAssignments(eventId) {
    const assignments = getAssignmentsForEvent(eventId);
    
    for (const assignment of assignments) {
        // Update ChurchTools EventService
        await churchtoolsClient.patch(
            `/events/${eventId}/services/${assignment.serviceId}`,
            { personId: assignment.userId }
        );
        
        // Mark as published
        assignment.publishedAt = new Date().toISOString();
        assignment.publishedPersonId = assignment.userId;
        await updateCustomDataValue(assignment);
    }
}
```

---

## Option 2: Direkter Ansatz

### Konzept
Jede Zuweisung schreibt sofort nach ChurchTools.

### Workflow
```
1. Zuweisung
   └─> Disponent klickt "Assign"
   └─> Schreibt direkt nach ChurchTools EventService
   └─> Person wird benachrichtigt (ChurchTools)

2. Änderung
   └─> Disponent entfernt/ändert Zuweisung
   └─> Schreibt direkt nach ChurchTools
```

### Vorteile
- ✅ Einfacher zu implementieren
- ✅ Keine Synchronisationsprobleme
- ✅ ChurchTools bleibt "Single Source of Truth"
- ✅ Andere ChurchTools-Features funktionieren sofort
- ✅ Keine Daten-Duplikation

### Nachteile
- ❌ Keine Undo-Funktion (nur durch erneute Änderung)
- ❌ Sofortige Benachrichtigungen an Personen
- ❌ Riskant bei Experimenten
- ❌ Keine parallele Planung mehrerer Szenarien
- ❌ Jede Änderung ist sofort sichtbar

### Implementierung
```typescript
async function assignPerson(eventId, serviceId, personId) {
    await churchtoolsClient.patch(
        `/events/${eventId}/services/${serviceId}`,
        { personId: personId }
    );
}

async function unassignPerson(eventId, serviceId) {
    await churchtoolsClient.patch(
        `/events/${eventId}/services/${serviceId}`,
        { personId: null }
    );
}
```

---

## Option 3: Hybrid-Ansatz

### Konzept
Toggle zwischen Draft-Modus und Live-Modus.

### Workflow
```
Draft-Modus:
└─> Speichert in Custom Data
└─> Keine ChurchTools-Änderungen

Live-Modus:
└─> Schreibt direkt nach ChurchTools
└─> Sofortige Benachrichtigungen
```

### Vorteile
- ✅ Flexibilität für verschiedene Workflows
- ✅ Sicheres Testen möglich
- ✅ Direktes Arbeiten möglich

### Nachteile
- ❌ Komplexer zu implementieren
- ❌ Zwei Datenquellen zu synchronisieren
- ❌ Benutzer müssen Modi verstehen
- ❌ Fehleranfällig bei Modus-Wechsel

---

## Option 1.5: Vereinfachter Zwei-Phasen-Ansatz

### Konzept
Nutzt ChurchTools als Single Source of Truth, aber mit Status-Flag.

### Workflow
```
1. Zuweisung (Entwurf)
   └─> Schreibt nach ChurchTools EventService
   └─> Setzt isAccepted = false (Entwurf)
   └─> Keine Benachrichtigung

2. Bestätigung
   └─> Disponent setzt isAccepted = true
   └─> Sendet Benachrichtigung
   └─> Person kann zusagen/absagen
```

### Vorteile
- ✅ Single Source of Truth (ChurchTools)
- ✅ Einfachere Synchronisation
- ✅ Undo möglich (Person wieder entfernen)
- ✅ ChurchTools zeigt Daten sofort (mit Status)
- ✅ Weniger Code als Option 1
- ✅ Nutzt vorhandenes ChurchTools-Feature (`isAccepted`)

### Nachteile
- ❌ Änderungen sind sofort in ChurchTools sichtbar (auch wenn Entwurf)
- ❌ Benachrichtigungen müssen manuell gesteuert werden
- ❌ Keine parallelen Planungs-Szenarien

### Implementierung
```typescript
// 1. Entwurfs-Zuweisung
async function assignPersonDraft(eventId, serviceId, personId) {
    await churchtoolsClient.patch(
        `/events/${eventId}/services/${serviceId}`,
        { 
            personId: personId,
            isAccepted: false  // Entwurf
        }
    );
}

// 2. Bestätigen und Benachrichtigen
async function confirmAssignment(eventId, serviceId) {
    await churchtoolsClient.patch(
        `/events/${eventId}/services/${serviceId}`,
        { isAccepted: true }
    );
    
    // Benachrichtigung senden
    await sendNotification(eventId, serviceId);
}
```

---

## Vergleichstabelle

| Kriterium | Option 1 | Option 2 | Option 3 | Option 1.5 |
|-----------|----------|----------|----------|------------|
| Komplexität | Hoch | Niedrig | Sehr hoch | Mittel |
| Sicherheit | Sehr hoch | Niedrig | Hoch | Hoch |
| Undo-Funktion | Ja | Nein | Ja (Draft) | Ja |
| Synchronisation | Komplex | Einfach | Komplex | Einfach |
| ChurchTools-Integration | Verzögert | Sofort | Gemischt | Sofort |
| Parallele Szenarien | Ja | Nein | Ja (Draft) | Nein |
| Implementierungsaufwand | Hoch | Niedrig | Sehr hoch | Mittel |

---

## Empfehlung

**Entscheidung: Option 1 (Zwei-Phasen-Ansatz)**

### Begründung
Die identifizierten Nachteile sind unter folgenden Bedingungen beherrschbar:

1. **Kein Multi-User-Problem:** Nur ein Disponent arbeitet gleichzeitig
2. **Synchronisation beim Laden:** Extension gleicht beim Start mit ChurchTools ab
3. **ChurchTools bleibt Single Source of Truth:** Extension ist nur Planungs-UI
4. **Umbesetzung möglich:** Auch bereits in CT besetzte Dienste können neu geplant werden

### Vereinfachungen durch diese Bedingungen

**Keine Konflikte zwischen Disponenten:**
- Kein Locking/Versionierung nötig
- Keine Konfliktauflösung erforderlich

**Synchronisation ist einfach:**
- Beim Laden: ChurchTools → Custom Data
- Beim Publish: Custom Data → ChurchTools
- Klare Richtung, keine Bidirektionalität während der Arbeit

**Umbesetzung-Workflow:**
```
1. Extension lädt Event mit personId=123 aus ChurchTools
2. Disponent plant um auf personId=456 (Custom Data)
3. UI zeigt beide:
   - "Aktuell in CT: Person 123"
   - "Geplant: Person 456"
4. Publish überschreibt ChurchTools mit 456
```

---

## Synchronisations-Szenarien

### Szenario 1: Erste Planung
```
ChurchTools: Dienst nicht besetzt (personId = null)
Custom Data: Keine Assignment
→ Disponent plant Person A
→ Custom Data: Assignment mit userId = A
→ UI: "Geplant: Person A" (neu)
→ Publish: ChurchTools personId = A
```

### Szenario 2: Umbesetzung
```
ChurchTools: Dienst besetzt mit Person A (personId = A)
Custom Data: Keine Assignment (oder alte Assignment)
→ Beim Laden: currentPersonId = A, plannedPersonId = A
→ Disponent plant um auf Person B
→ Custom Data: Assignment mit userId = B
→ UI: "Aktuell: Person A, Geplant: Person B" (geändert)
→ Publish: ChurchTools personId = B
```

### Szenario 3: Planung verwerfen
```
ChurchTools: Dienst besetzt mit Person A
Custom Data: Assignment mit userId = B
→ UI: "Aktuell: Person A, Geplant: Person B"
→ Disponent verwirft Planung
→ Custom Data: Assignment gelöscht
→ UI: "Aktuell: Person A" (unverändert)
```

### Szenario 4: Externe Änderung in ChurchTools
```
Session Start:
  ChurchTools: personId = A
  Custom Data: Assignment userId = B
  → UI: "Aktuell: Person A, Geplant: Person B"

Jemand ändert in ChurchTools direkt auf Person C

Nächster Session Start:
  ChurchTools: personId = C
  Custom Data: Assignment userId = B (veraltet)
  → UI: "Aktuell: Person C, Geplant: Person B"
  → Warnung: "ChurchTools wurde extern geändert"
  
Optionen:
  1. Planung beibehalten (B publishen → überschreibt C)
  2. Planung verwerfen (C akzeptieren)
  3. Neu planen (andere Person)
```

### Szenario 5: Dienst entfernen
```
ChurchTools: Dienst besetzt mit Person A
Custom Data: Keine Assignment
→ Disponent will Dienst frei lassen
→ Custom Data: Assignment mit userId = null, status = 'removed'
→ UI: "Aktuell: Person A, Geplant: (frei)" (entfernt)
→ Publish: ChurchTools personId = null
```

## Offene Fragen

1. **Benachrichtigungen:** 
   - Beim Publish automatisch benachrichtigen?
   - Oder manueller "Benachrichtigen"-Button?
   - ChurchTools-eigene Benachrichtigungen nutzen?

2. **Berechtigungen:** 
   - Wer darf Dienste zuweisen? (Aktuell: alle mit Extension-Zugriff)
   - Wer darf publishen? (Aktuell: alle mit Extension-Zugriff)

3. **Externe Personen:** 
   - `isExternal` Flag und `externalName` bereits im Datenmodell
   - Wie werden diese in UI dargestellt?
   - Können externe Personen in ChurchTools geschrieben werden?

4. **Historisierung:** 
   - Custom Data behält alte Assignments
   - Soll es eine History-Ansicht geben?
   - Wann werden alte Assignments gelöscht?

5. **Fehlerbehandlung beim Publish:**
   - Was wenn einzelne Updates fehlschlagen?
   - Rollback oder partial success?
   - Wie wird Benutzer informiert?

6. **Bulk-Operationen:** 
   - "Publish all changes" Button?
   - Oder nur einzeln publishen?
   - Preview vor Bulk-Publish?

---

## Detaillierter Workflow für Option 1

### Beim Laden der Extension

```typescript
async function loadAndSyncData() {
    // 1. Lade ChurchTools Events mit EventServices
    const events = await loadEvents(); // enthält personId aus CT
    
    // 2. Lade Custom Data Assignments (Planung)
    const assignments = await loadAssignments();
    
    // 3. Merge für UI
    events.forEach(event => {
        event.eventServices.forEach(es => {
            const assignment = assignments.get(`${event.id}-${es.serviceId}`);
            
            es.currentPersonId = es.personId;  // Aus ChurchTools
            es.plannedPersonId = assignment?.userId || null;  // Aus Planung
            es.hasChanges = es.currentPersonId !== es.plannedPersonId;
        });
    });
}
```

### UI-Darstellung

```
Event: Gottesdienst 15.12.2024
├─ Dienst: Technik
│  ├─ Aktuell in CT: Max Mustermann
│  ├─ Geplant: Maria Schmidt ⚠️ (Änderung)
│  └─ [Publish] Button
│
├─ Dienst: Musik
│  ├─ Aktuell in CT: (nicht besetzt)
│  ├─ Geplant: Tom Weber ⚠️ (Neu)
│  └─ [Publish] Button
│
└─ Dienst: Moderation
   ├─ Aktuell in CT: Anna Klein
   ├─ Geplant: Anna Klein ✓ (Unverändert)
   └─ [Bereits in CT]
```

### Status-Übergänge

```typescript
interface EventServiceState {
    currentPersonId: number | null;  // Aus ChurchTools
    plannedPersonId: number | null;  // Aus Custom Data
    status: 'unchanged' | 'new' | 'changed' | 'removed';
}

function getStatus(es: EventServiceState): string {
    if (es.currentPersonId === null && es.plannedPersonId === null) {
        return 'unchanged';  // Nicht besetzt, keine Planung
    }
    if (es.currentPersonId === null && es.plannedPersonId !== null) {
        return 'new';  // Neu geplant
    }
    if (es.currentPersonId !== null && es.plannedPersonId === null) {
        return 'removed';  // Geplant zu entfernen
    }
    if (es.currentPersonId !== es.plannedPersonId) {
        return 'changed';  // Umbesetzung geplant
    }
    return 'unchanged';  // Gleiche Person
}
```

### Publish-Funktion

```typescript
async function publishAssignments(eventId: number) {
    const event = events.find(e => e.id === eventId);
    
    for (const es of event.eventServices) {
        const status = getStatus(es);
        
        if (status === 'unchanged') {
            continue;  // Nichts zu tun
        }
        
        // Update ChurchTools
        await churchtoolsClient.patch(
            `/events/${eventId}/services/${es.id}`,
            { personId: es.plannedPersonId }
        );
        
        // Update Custom Data: markiere als published
        const assignment = assignments.get(`${eventId}-${es.serviceId}`);
        if (assignment) {
            assignment.publishedAt = new Date().toISOString();
            await updateCustomDataValue(assignment);
        }
        
        // Sync state
        es.currentPersonId = es.plannedPersonId;
        es.hasChanges = false;
    }
}
```

### Umbesetzung-Workflow

```typescript
// Szenario: Dienst ist in CT mit Person A besetzt, 
// Disponent plant um auf Person B

async function reassignService(eventId: number, serviceId: number, newPersonId: number) {
    // 1. Finde EventService
    const es = findEventService(eventId, serviceId);
    
    // es.currentPersonId = 123 (Person A, aus ChurchTools)
    // es.plannedPersonId = 123 (noch keine Änderung)
    
    // 2. Erstelle/Update Assignment in Custom Data
    await createOrUpdateAssignment({
        eventId,
        serviceId,
        userId: newPersonId,  // Person B
        assignedBy: currentUser.id,
        assignedAt: new Date().toISOString(),
        status: 'assigned'
    });
    
    // 3. Update UI state
    es.plannedPersonId = newPersonId;  // Person B
    es.hasChanges = true;  // 123 !== newPersonId
    
    // 4. UI zeigt jetzt:
    // "Aktuell in CT: Person A"
    // "Geplant: Person B" ⚠️
}
```

### Löschen einer Planung

```typescript
async function cancelPlannedAssignment(eventId: number, serviceId: number) {
    const es = findEventService(eventId, serviceId);
    
    // Lösche Assignment aus Custom Data
    await deleteAssignment(eventId, serviceId);
    
    // Zurück zum ChurchTools-Stand
    es.plannedPersonId = es.currentPersonId;
    es.hasChanges = false;
}
```

### Bulk-Publish

```typescript
async function publishAllChanges() {
    const changedServices = getAllEventServices()
        .filter(es => es.hasChanges);
    
    console.log(`Publishing ${changedServices.length} changes...`);
    
    for (const es of changedServices) {
        try {
            await publishAssignment(es.eventId, es.serviceId);
        } catch (error) {
            console.error(`Failed to publish ${es.eventId}-${es.serviceId}:`, error);
            // Sammle Fehler, aber fahre fort
        }
    }
    
    // Reload um sicherzustellen, dass alles synchron ist
    await loadAndSyncData();
}
```

## Nächste Schritte

1. ✅ Entscheidung für Option 1 getroffen
2. API-Endpunkte in ChurchTools prüfen (PATCH `/events/{id}/services/{serviceId}`)
3. Datenmodell für Assignment Custom Data finalisieren
4. Sync-Logik beim Laden implementieren
5. UI für Status-Anzeige (current vs. planned) implementieren
6. Assignment-Funktion implementieren
7. Publish-Funktion implementieren
8. Mit Test-Daten testen
9. Produktiv schalten
