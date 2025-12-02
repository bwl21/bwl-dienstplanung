# Planungsszenarien mit Berechtigungen

## Überblick

Die Extension unterstützt mehrere Planungsszenarien (z.B. "Service", "Technik-GZ", "Deko"), wobei jedes Szenario eigene Daten und Berechtigungen hat.

## Konzept

### Planungsszenario

```mermaid
graph LR
    A[Planungsszenario] --> B[Konfiguration]
    A --> C[Disponent-Daten]
    A --> D[Mitarbeiter-Daten]
    
    B --> B1[ID: service]
    B --> B2[Name: Service]
    B --> B3[Service-Kategorie]
    B --> B4[Berechtigungen]
    
    C --> C1[Assignments]
    C --> C2[Nur Disponenten]
    
    D --> D1[Availabilities]
    D --> D2[Nur Mitarbeiter]
```

Ein Planungsszenario repräsentiert einen Planungskontext mit:
- **ID:** Eindeutiger Identifier (z.B. "service", "technik-gz", "deko")
- **Name:** Anzeigename (z.B. "Service", "Technik-GZ", "Deko")
- **Beschreibung:** Erklärung des Szenarios
- **Service-Kategorie:** Verknüpfung zu ChurchTools Dienstkategorie
- **Berechtigungen:** Separate Listen für Disponent- und Mitarbeiter-Zugriff

### Datentypen pro Szenario

```mermaid
graph TD
    S[Szenario: Service] --> D[Disponent-Daten]
    S --> M[Mitarbeiter-Daten]
    
    D --> D1[Kategorie: service__disponent]
    D1 --> D2[Assignments]
    D1 --> D3[Nur für Disponenten]
    
    M --> M1[Kategorie: service__mitarbeiter]
    M1 --> M2[Availabilities]
    M1 --> M3[Nur für Mitarbeiter]
```

Jedes Szenario hat zwei Datentypen:

1. **Disponent-Daten:** Planungsdaten (Assignments, etc.)
   - Nur für Disponenten sichtbar/editierbar
   - Kategorie: `{scenario-id}__disponent`

2. **Mitarbeiter-Daten:** Verfügbarkeiten, Präferenzen
   - Für Mitarbeiter sichtbar/editierbar
   - Kategorie: `{scenario-id}__mitarbeiter`

## Custom Data Kategorien

### Struktur-Übersicht

```mermaid
graph TD
    A[Extension Module] --> B[scenarios]
    A --> C[settings]
    A --> D[service__disponent]
    A --> E[service__mitarbeiter]
    A --> F[technik-gz__disponent]
    A --> G[technik-gz__mitarbeiter]
    A --> H[deko__disponent]
    A --> I[deko__mitarbeiter]
    
    B --> B1[Szenario-Konfigurationen]
    C --> C1[Globale Einstellungen]
    D --> D1[Assignments für Service]
    E --> E1[Availabilities für Service]
    F --> F1[Assignments für Technik-GZ]
    G --> G1[Availabilities für Technik-GZ]
    H --> H1[Assignments für Deko]
    I --> I1[Availabilities für Deko]
```

### Naming Convention

```
{scenario-id}__{data-type}
```

**Doppel-Unterstrich `__` als Trennzeichen** für klare Trennung zwischen Szenario-ID und Datentyp.

**Beispiele:**
- `service__disponent` - Disponent-Daten für Service
- `service__mitarbeiter` - Mitarbeiter-Daten für Service
- `technik-gz__disponent` - Disponent-Daten für Technik-GZ
- `technik-gz__mitarbeiter` - Mitarbeiter-Daten für Technik-GZ
- `deko__disponent` - Disponent-Daten für Deko
- `deko__mitarbeiter` - Mitarbeiter-Daten für Deko

**Parsing:**
```javascript
const [scenarioId, dataType] = categoryName.split('__');
// "technik-gz__mitarbeiter" → ["technik-gz", "mitarbeiter"]
```

## Datenmodell

### Szenario-Konfiguration

```mermaid
erDiagram
    SCENARIO {
        string id
        string name
        string description
        string serviceCategoryId
        array disponentPermissions
        array mitarbeiterPermissions
        string createdAt
        number createdBy
    }
```

Gespeichert in Kategorie `scenarios`:
- ID des Szenarios
- Anzeigename
- Beschreibung
- ChurchTools Service Category ID
- Liste der User-IDs mit Disponent-Berechtigung
- Liste der User-IDs mit Mitarbeiter-Berechtigung
- Erstellungszeitpunkt und Ersteller

### Disponent-Daten (Assignments)

```mermaid
erDiagram
    ASSIGNMENT {
        number eventId
        number serviceId
        number userId
        number assignedBy
        string assignedAt
        string status
        boolean isExternal
        string externalName
        string publishedAt
        number publishedPersonId
    }
```

Gespeichert in Kategorie `{scenario-id}__disponent`:
- Event-ID und Service-ID
- Zugewiesene Person (User-ID oder null)
- Wer hat zugewiesen und wann
- Status (assigned, confirmed, declined)
- Externe Person (Flag und Name)
- Publish-Informationen (Zeitpunkt und was published wurde)

### Mitarbeiter-Daten (Availabilities)

```mermaid
erDiagram
    AVAILABILITY {
        number eventId
        number serviceId
        number userId
        string status
        string timestamp
        string comment
    }
```

Gespeichert in Kategorie `{scenario-id}__mitarbeiter`:
- Event-ID und Service-ID
- User-ID
- Verfügbarkeits-Status (yes, maybe, no, absent)
- Zeitstempel
- Optional: Kommentar

## Workflow

### Berechtigungsprüfung

```mermaid
flowchart TD
    A[User öffnet Extension] --> B[Lade Szenarien]
    B --> C{Hat User Zugriff?}
    C -->|Disponent| D[Zeige Disponent-View]
    C -->|Mitarbeiter| E[Zeige Mitarbeiter-View]
    C -->|Beide| F[Zeige beide Views]
    C -->|Keine| G[Zeige Fehlermeldung]
    
    D --> H[Lade Assignments]
    E --> I[Lade Availabilities]
    F --> H
    F --> I
```

### Daten-Zugriff

```mermaid
sequenceDiagram
    participant U as User
    participant E as Extension
    participant P as Permission Check
    participant K as KV-Store
    
    U->>E: Lade Assignments für "service"
    E->>P: Prüfe Disponent-Berechtigung
    P->>K: Lade Szenario-Config
    K-->>P: Config mit Berechtigungen
    P-->>E: Berechtigung OK
    E->>K: Lade service-disponent Daten
    K-->>E: Assignments
    E-->>U: Zeige Assignments
```

### Setup-Prozess

```mermaid
flowchart LR
    A[Szenario erstellen] --> B[Config in 'scenarios' speichern]
    B --> C[Disponent-Kategorie erstellen]
    B --> D[Mitarbeiter-Kategorie erstellen]
    C --> E[service__disponent]
    D --> F[service__mitarbeiter]
```

## Berechtigungs-Optionen

```mermaid
graph TD
    A[Berechtigungs-Optionen] --> B[Option 1: User IDs]
    A --> C[Option 2: ChurchTools Gruppen]
    A --> D[Option 3: Hybrid]
    
    B --> B1[+ Einfach]
    B --> B2[+ Schnell]
    B --> B3[- Manuell]
    
    C --> C1[+ ChurchTools-Integration]
    C --> C2[+ Automatische Updates]
    C --> C3[- Zusätzliche API-Calls]
    
    D --> D1[+ Flexibel]
    D --> D2[- Komplex]
```

### Option 1: User IDs

Speichere User-IDs direkt in der Szenario-Konfiguration.

**Vorteile:**
- Einfach zu implementieren
- Schnelle Prüfung

**Nachteile:**
- Manuelles Hinzufügen/Entfernen von Usern
- Keine Gruppen-Unterstützung

### Option 2: ChurchTools Gruppen

Nutze ChurchTools-Gruppen für Berechtigungen (z.B. "Service-Disponent", "Service-Mitarbeiter").

**Vorteile:**
- Nutzt ChurchTools-Berechtigungssystem
- Gruppen-Verwaltung in ChurchTools
- Automatische Updates bei Gruppen-Änderungen

**Nachteile:**
- Zusätzliche API-Calls
- Abhängigkeit von ChurchTools-Gruppen

### Option 3: Hybrid

Kombiniere User-IDs und Gruppen-IDs für maximale Flexibilität.

## Best Practices

```mermaid
mindmap
  root((Best Practices))
    Initialisierung
      Szenarien beim Start erstellen
      Kategorien vorbereiten
    Performance
      Berechtigungen cachen
      Batch-Operationen
    Sicherheit
      Berechtigungen prüfen
      Audit-Logging
    UX
      Klare Fehlermeldungen
      Berechtigungen anzeigen
      Intuitive Navigation
```

1. **Initialisierung:** Erstelle alle Szenarien beim ersten Start
2. **Caching:** Cache Berechtigungen für Performance
3. **Fehlerbehandlung:** Zeige benutzerfreundliche Fehlermeldungen bei fehlenden Berechtigungen
4. **Audit:** Logge alle Berechtigungs-Prüfungen
5. **UI-Feedback:** Zeige deutlich, welche Berechtigungen der User hat

## Migration

```mermaid
flowchart LR
    A[Alte Daten] --> B[Default-Szenario erstellen]
    B --> C[Daten nach default__disponent verschieben]
    B --> D[Daten nach default__mitarbeiter verschieben]
    C --> E[Berechtigungen setzen]
    D --> E
```

Wenn bereits Daten ohne Szenarien existieren:
1. Erstelle ein "default" Szenario
2. Verschiebe bestehende Assignments nach `default__disponent`
3. Verschiebe bestehende Availabilities nach `default__mitarbeiter`
4. Setze passende Berechtigungen

## Siehe auch

- [Key-Value Store Guide](key-value-store.md) - Grundlagen des KV-Stores
- [Assignment Strategy](assignment-strategy.md) - Dienstplanungs-Strategie
