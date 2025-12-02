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
    userId: number;
    assignedBy: number;
    assignedAt: string;
    status: 'assigned' | 'confirmed' | 'declined';
    isExternal: boolean;
    externalName?: string;
}
```

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

### Implementierung
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

// 2. Publish
async function publishAssignments(eventId) {
    const assignments = getAssignmentsForEvent(eventId);
    
    for (const assignment of assignments) {
        if (assignment.status === 'confirmed') {
            // Update ChurchTools EventService
            await churchtoolsClient.patch(
                `/events/${eventId}/services/${assignment.serviceId}`,
                { personId: assignment.userId }
            );
            
            // Mark as published
            assignment.published = true;
            await updateCustomDataValue(assignment);
        }
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

**Für den Start: Option 1.5 (Vereinfachter Zwei-Phasen-Ansatz)**

### Begründung
- Guter Kompromiss zwischen Sicherheit und Einfachheit
- Nutzt ChurchTools-Features (`isAccepted`)
- Einfacher zu implementieren als Option 1
- Sicherer als Option 2
- Kann später zu Option 1 erweitert werden

### Migrations-Pfad
```
Phase 1: Option 1.5 implementieren
└─> Basis-Funktionalität mit isAccepted-Flag

Phase 2: Bei Bedarf zu Option 1 erweitern
└─> Custom Data für komplexere Workflows
└─> Publish-Funktion hinzufügen
```

---

## Offene Fragen

1. **Benachrichtigungen:** Wann und wie sollen Personen benachrichtigt werden?
2. **Berechtigungen:** Wer darf Dienste zuweisen/bestätigen?
3. **Externe Personen:** Wie werden nicht-ChurchTools-Benutzer behandelt?
4. **Konfliktauflösung:** Was passiert bei gleichzeitigen Änderungen?
5. **Historisierung:** Sollen Änderungen protokolliert werden?
6. **Bulk-Operationen:** Mehrere Zuweisungen auf einmal?

---

## Nächste Schritte

1. Entscheidung für eine Option treffen
2. API-Endpunkte in ChurchTools prüfen (PATCH `/events/{id}/services/{serviceId}`)
3. Prototyp implementieren
4. Mit Test-Daten testen
5. Feedback einholen
6. Produktiv schalten
