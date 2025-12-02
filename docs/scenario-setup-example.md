# Szenario Setup Beispiel

## Manuelles Erstellen eines Szenarios

Da noch keine UI für Szenario-Verwaltung existiert, kann ein Szenario manuell über die Browser-Console erstellt werden:

### 1. Öffne die Extension in ChurchTools

### 2. Öffne Browser Console (F12)

### 3. Erstelle ein Test-Szenario

```javascript
// Hole das Extension Module
const module = await churchtoolsClient.get('/api/modules').then(r => 
    r.data.find(m => m.key === 'bwl-dienstplanung')
);

// Erstelle oder hole scenarios Kategorie
let scenariosCategory = await churchtoolsClient.get(`/api/modules/${module.id}/data/categories`)
    .then(r => r.data.find(c => c.shorty === 'scenarios'))
    .catch(() => null);

if (!scenariosCategory) {
    scenariosCategory = await churchtoolsClient.post(`/api/modules/${module.id}/data/categories`, {
        customModuleId: module.id,
        name: 'Planning Scenarios',
        shorty: 'scenarios',
        description: 'Configuration for planning scenarios'
    }).then(r => r.data);
}

// Erstelle Szenario-Konfiguration
const scenarioConfig = {
    id: 'service',
    name: 'Service',
    description: 'Gottesdienst-Planung',
    calendarIds: [1, 2],           // Anpassen: Deine Kalender-IDs
    serviceCategoryIds: [10, 11],  // Anpassen: Deine Dienstkategorie-IDs
    serviceGroupIds: [20, 21, 22], // Anpassen: Deine Besetzergruppen-IDs
    disponentPermissions: [1, 2, 3],
    mitarbeiterPermissions: [1, 2, 3, 4, 5, 6],
    createdAt: new Date().toISOString(),
    createdBy: 1
};

// Speichere Szenario
await churchtoolsClient.post(
    `/api/modules/${module.id}/data/categories/${scenariosCategory.id}/values`,
    {
        dataCategoryId: scenariosCategory.id,
        value: JSON.stringify(scenarioConfig)
    }
);

console.log('Szenario erstellt:', scenarioConfig.name);
```

### 4. Erstelle Daten-Kategorien für das Szenario

```javascript
// Disponent-Kategorie
await churchtoolsClient.post(`/api/modules/${module.id}/data/categories`, {
    customModuleId: module.id,
    name: 'service - Disponent Data',
    shorty: 'service__disponent',
    description: 'Disponent planning data for service'
});

// Mitarbeiter-Kategorie
await churchtoolsClient.post(`/api/modules/${module.id}/data/categories`, {
    customModuleId: module.id,
    name: 'service - Mitarbeiter Data',
    shorty: 'service__mitarbeiter',
    description: 'Mitarbeiter data for service'
});

console.log('Kategorien erstellt');
```

### 5. Lade Extension neu

Die Extension sollte jetzt das Szenario laden und Events/Services entsprechend filtern.

## IDs herausfinden

### Kalender-IDs

```javascript
const calendars = await churchtoolsClient.get('/api/calendars');
console.table(calendars.data.map(c => ({ id: c.id, name: c.name })));
```

### Dienstkategorie-IDs

```javascript
const serviceGroups = await churchtoolsClient.get('/api/servicegroups');
console.table(serviceGroups.data.map(sg => ({ id: sg.id, name: sg.name })));
```

### Service-IDs (innerhalb einer Kategorie)

```javascript
const categoryId = 10; // Anpassen
const services = await churchtoolsClient.get(`/api/services?servicegroup_id=${categoryId}`);
console.table(services.data.map(s => ({ 
    id: s.id, 
    name: s.name, 
    serviceGroupId: s.serviceGroupId 
})));
```

## Beispiel-Szenarien

### Service (Gottesdienst)

```javascript
{
    id: 'service',
    name: 'Service',
    description: 'Gottesdienst-Planung',
    calendarIds: [1, 2],           // Gottesdienst, Jugendgottesdienst
    serviceCategoryIds: [10, 11, 12], // Technik, Musik, Moderation
    serviceGroupIds: [20, 21, 22, 23], // Technik-Team A/B, Musik-Band/Chor
    disponentPermissions: [1, 2, 3],
    mitarbeiterPermissions: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    createdAt: new Date().toISOString(),
    createdBy: 1
}
```

### Technik-GZ

```javascript
{
    id: 'technik-gz',
    name: 'Technik-GZ',
    description: 'Technik Gemeinschaftszentrum',
    calendarIds: [3],              // GZ-Veranstaltungen
    serviceCategoryIds: [10],      // Technik
    serviceGroupIds: [24],         // Technik-Team C
    disponentPermissions: [7, 8],
    mitarbeiterPermissions: [7, 8, 9, 10, 11, 12],
    createdAt: new Date().toISOString(),
    createdBy: 7
}
```

### Deko

```javascript
{
    id: 'deko',
    name: 'Deko',
    description: 'Dekoration',
    calendarIds: [1, 2, 3, 4],     // Alle Veranstaltungskalender
    serviceCategoryIds: [15],      // Dekoration
    serviceGroupIds: [30],         // Deko-Team
    disponentPermissions: [11],
    mitarbeiterPermissions: [11, 12, 13, 14, 15],
    createdAt: new Date().toISOString(),
    createdBy: 11
}
```

## Szenario löschen

```javascript
// Hole alle Szenarien
const module = await churchtoolsClient.get('/api/modules').then(r => 
    r.data.find(m => m.key === 'bwl-dienstplanung')
);

const scenariosCategory = await churchtoolsClient.get(`/api/modules/${module.id}/data/categories`)
    .then(r => r.data.find(c => c.shorty === 'scenarios'));

const scenarios = await churchtoolsClient.get(
    `/api/modules/${module.id}/data/categories/${scenariosCategory.id}/values`
).then(r => r.data);

console.table(scenarios.map(s => {
    const config = JSON.parse(s.value);
    return { id: s.id, scenarioId: config.id, name: config.name };
}));

// Lösche ein Szenario
const valueId = 123; // Anpassen
await churchtoolsClient.delete(
    `/api/modules/${module.id}/data/categories/${scenariosCategory.id}/values/${valueId}`
);
```

## Debugging

### Prüfe geladenes Szenario

In der Browser Console nach Extension-Laden:

```
[Disponent-Table] Using scenario: Service
[Disponent-Table] Filtered 62 events to 45 by calendar
[Disponent-Table] Filtered 150 services to 80 by service groups
```

### Prüfe Szenario-Daten

```javascript
const module = await churchtoolsClient.get('/api/modules').then(r => 
    r.data.find(m => m.key === 'bwl-dienstplanung')
);

const scenariosCategory = await churchtoolsClient.get(`/api/modules/${module.id}/data/categories`)
    .then(r => r.data.find(c => c.shorty === 'scenarios'));

const scenarios = await churchtoolsClient.get(
    `/api/modules/${module.id}/data/categories/${scenariosCategory.id}/values`
).then(r => r.data);

scenarios.forEach(s => {
    const config = JSON.parse(s.value);
    console.log('Szenario:', config.name);
    console.log('  Kalender:', config.calendarIds);
    console.log('  Kategorien:', config.serviceCategoryIds);
    console.log('  Gruppen:', config.serviceGroupIds);
});
```
