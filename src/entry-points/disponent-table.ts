import type { EntryPoint } from '../lib/main';
import type { MainModuleData } from '@churchtools/extension-points/main';
import { getModule, getCustomDataCategory, getCustomDataValues, createCustomDataCategory } from '../utils/kv-store';

/**
 * Disponent Table Entry Point
 *
 * Tabellen-basierte Ansicht für Disponenten nach Design-Vorlage.
 * Zeigt Events mit aggregierten Diensten und Verfügbarkeiten.
 */


interface ScenarioConfig {
    shortName: string;
    name: string;
    description: string;
    calendarIds: number[];
    serviceCategoryIds: number[];
    serviceGroupIds: number[];
    disponentPermissions: number[];
    mitarbeiterPermissions: number[];
    createdAt: string;
    createdBy: number;
    // Metadata from Custom Data Value:
    id?: number;
    dataCategoryId?: number;
}

interface Event {
    id: number;
    name: string;
    startDate: string;
    endDate?: string;
    eventServices?: EventService[];
    calendar?: {
        id?: number;
        title: string;
        domainIdentifier: string;
    };
    [key: string]: any;
}

interface EventService {
    id: number;
    serviceId: number;
    personId: number | null;
    isAccepted: boolean;
    [key: string]: any;
}

interface Service {
    id: number;
    name: string;
    serviceGroupId: number;
    [key: string]: any;
}

interface Availability {
    eventId: number;
    serviceId: number;
    userId: number;
    status: 'yes' | 'maybe' | 'no' | 'absent';
    timestamp: string;
    comment?: string;
}

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

interface Person {
    id: number;
    firstName: string;
    lastName: string;
    [key: string]: any;
}

const disponentTableEntryPoint: EntryPoint<MainModuleData> = ({ element, churchtoolsClient, KEY }) => {
    console.log('[Disponent-Table] Initializing');

    let scenarios: ScenarioConfig[] = [];
    let currentScenario: ScenarioConfig | null = null;
    let events: Event[] = [];
    let services: Service[] = [];
    let availabilities: Map<string, Availability> = new Map();
    let assignments: Map<string, Assignment> = new Map();
    let persons: Map<number, Person> = new Map();
    let isLoading = true;
    let errorMessage = '';
    let moduleId: number | null = null;
    // @ts-ignore - Used for category tracking
    let availabilityCategory: any = null;
    // @ts-ignore - Used for category tracking
    let assignmentCategory: any = null;

    // Filter state
    let dateRange: number = 28;

    async function initialize() {
        try {
            isLoading = true;
            render();

            await loadSettings();

            if (!currentScenario) {
                errorMessage = 'Kein Szenario konfiguriert. Bitte in den Admin-Einstellungen ein Szenario erstellen.';
                isLoading = false;
                render();
                return;
            }

            await Promise.all([
                loadEvents(),
                loadServices(),
                loadAvailabilities(),
                loadAssignments()
            ]);
            
            await loadPersons();

            console.log('[Disponent-Table] Loaded:', {
                events: events.length,
                services: services.length,
                persons: persons.size
            });

            isLoading = false;
            errorMessage = '';
            render();
        } catch (error) {
            console.error('[Disponent-Table] Error:', error);
            isLoading = false;
            errorMessage = error instanceof Error ? error.message : 'Fehler beim Laden';
            render();
        }
    }

    async function loadScenarios(): Promise<ScenarioConfig[]> {
        try {
            const extensionModule = await getModule(KEY);
            const category = await getCustomDataCategory<object>('scenarios');
            
            if (!category) return [];
            
            return await getCustomDataValues<ScenarioConfig>(category.id, extensionModule.id);
        } catch (error) {
            console.error('[Disponent-Table] Failed to load scenarios:', error);
            return [];
        }
    }

    async function loadSettings(): Promise<void> {
        try {
            const extensionModule = await getModule(KEY);
            moduleId = extensionModule.id;

            // Load scenarios
            scenarios = await loadScenarios();
            
            if (scenarios.length > 0) {
                // Try to load saved scenario from localStorage
                const savedScenarioShortName = localStorage.getItem('bwl-dienstplanung-scenario');
                currentScenario = scenarios.find(s => s.shortName === savedScenarioShortName) || scenarios[0];
                console.log('[Disponent-Table] Using scenario:', currentScenario.name);
            }
        } catch (error) {
            console.log('[Disponent-Table] Could not load settings:', error);
        }
    }
    
    async function switchScenario(shortName: string) {
        const newScenario = scenarios.find(s => s.shortName === shortName);
        if (!newScenario) return;
        
        currentScenario = newScenario;
        localStorage.setItem('bwl-dienstplanung-scenario', shortName);
        console.log('[Disponent-Table] Switched to scenario:', currentScenario.name);
        
        // Reload data
        isLoading = true;
        render();
        
        await Promise.all([
            loadEvents(),
            loadServices(),
            loadAvailabilities(),
            loadAssignments()
        ]);
        
        await loadPersons();
        
        isLoading = false;
        render();
    }

    async function loadEvents(): Promise<void> {
        try {
            const today = new Date().toISOString().split('T')[0];
            const endDate = new Date();
            endDate.setDate(endDate.getDate() + dateRange);
            const end = endDate.toISOString().split('T')[0];
            
            const response = await churchtoolsClient.get(`/events?from=${today}&to=${end}&limit=100&include=eventServices`) as any;
            let allEvents = response.data || response || [];
            
            // Filter events by scenario criteria
            if (currentScenario && currentScenario.calendarIds.length > 0) {
                events = allEvents.filter((event: Event) => {
                    const calendarId = event.calendar?.id || event.calendar?.domainIdentifier;
                    if (!calendarId) return false;
                    return currentScenario!.calendarIds.includes(Number(calendarId));
                });
                console.log(`[Disponent-Table] Filtered ${allEvents.length} events to ${events.length} by calendar`);
            } else {
                events = allEvents;
            }
        } catch (error) {
            console.error('[Disponent-Table] Failed to load events:', error);
            events = [];
        }
    }

    async function loadServices(): Promise<void> {
        try {
            let allServices = [];
            
            if (currentScenario && currentScenario.serviceCategoryIds.length > 0) {
                // Load services for all configured categories
                for (const categoryId of currentScenario.serviceCategoryIds) {
                    try {
                        const response = await churchtoolsClient.get(`/services?servicegroup_id=${categoryId}`) as any;
                        const categoryServices = response.data || response || [];
                        allServices.push(...categoryServices);
                    } catch (error) {
                        console.error(`[Disponent-Table] Failed to load services for category ${categoryId}:`, error);
                    }
                }
                
                // Filter by service groups if configured
                if (currentScenario.serviceGroupIds.length > 0) {
                    services = allServices.filter((service: Service) => {
                        return currentScenario!.serviceGroupIds.includes(service.serviceGroupId);
                    });
                    console.log(`[Disponent-Table] Filtered ${allServices.length} services to ${services.length} by service groups`);
                } else {
                    services = allServices;
                }
            } else {
                services = [];
            }
        } catch (error) {
            console.error('[Disponent-Table] Failed to load services:', error);
            services = [];
        }
    }

    async function loadAvailabilities(): Promise<void> {
        try {
            if (!moduleId) return;

            let category = await getCustomDataCategory<object>('availabilities');
            if (!category) return;
            availabilityCategory = category;

            const values = await getCustomDataValues<Availability>(category.id, moduleId);
            
            availabilities.clear();
            values.forEach(val => {
                const key = `${val.eventId}-${val.serviceId}-${val.userId}`;
                availabilities.set(key, val);
            });
        } catch (error) {
            console.error('[Disponent-Table] Failed to load availabilities:', error);
        }
    }

    async function loadAssignments(): Promise<void> {
        try {
            if (!moduleId) return;

            let category = await getCustomDataCategory<object>('assignments');
            if (!category) {
                category = await createCustomDataCategory({
                    customModuleId: moduleId,
                    name: 'Assignments',
                    shorty: 'assignments',
                    description: 'Service assignments',
                }, moduleId);
            }
            assignmentCategory = category;

            const values = await getCustomDataValues<Assignment>(category.id, moduleId);
            
            assignments.clear();
            values.forEach(val => {
                const key = `${val.eventId}-${val.serviceId}`;
                assignments.set(key, val);
            });
        } catch (error) {
            console.error('[Disponent-Table] Failed to load assignments:', error);
        }
    }

    async function loadPersons(): Promise<void> {
        try {
            const personIds = new Set<number>();
            
            // Collect person IDs from event services (assigned persons)
            events.forEach(event => {
                (event.eventServices || []).forEach(es => {
                    if (es.personId) {
                        personIds.add(es.personId);
                    }
                });
            });
            
            // Collect person IDs from availabilities
            availabilities.forEach(avail => {
                personIds.add(avail.userId);
            });
            
            // Collect person IDs from assignments
            assignments.forEach(assignment => {
                personIds.add(assignment.userId);
            });
            
            if (personIds.size === 0) {
                console.log('[Disponent-Table] No person IDs to load');
                return;
            }
            
            persons.clear();
            
            const idsArray = Array.from(personIds);
            console.log(`[Disponent-Table] Loading ${idsArray.length} persons with ids[] parameter`);
            
            // Build URL with ids[] parameter - load in batches to avoid URL length limits
            const batchSize = 100;
            for (let i = 0; i < idsArray.length; i += batchSize) {
                const batch = idsArray.slice(i, i + batchSize);
                
                const params = new URLSearchParams();
                batch.forEach(id => {
                    params.append('ids[]', id.toString());
                });
                params.append('limit', batch.length.toString());
                
                const url = `/persons?${params.toString()}`;
                
                try {
                    const response = await churchtoolsClient.get(url) as any;
                    const personList = response.data || response || [];
                    
                    personList.forEach((p: Person) => {
                        persons.set(p.id, p);
                    });
                    
                    console.log(`[Disponent-Table] Batch ${Math.floor(i/batchSize)+1}: loaded ${personList.length} of ${batch.length} requested`);
                } catch (error) {
                    console.error(`[Disponent-Table] Failed to load person batch:`, error);
                }
            }
            
            console.log(`[Disponent-Table] Loaded ${persons.size} persons (needed ${personIds.size})`);
            
            if (persons.size < personIds.size) {
                console.warn('[Disponent-Table] Missing persons:', personIds.size - persons.size);
            }
        } catch (error) {
            console.error('[Disponent-Table] Failed to load persons:', error);
        }
    }

    function getPersonName(userId: number): string {
        const person = persons.get(userId);
        if (!person) return `User ${userId}`;
        return `${person.firstName} ${person.lastName}`;
    }

    function getWorkload(userId: number): number {
        let count = 0;
        assignments.forEach((assignment) => {
            if (assignment.userId === userId) {
                count++;
            }
        });
        return count;
    }

    function getAvailablePersons(eventId: number, serviceId: number): Array<{person: Person, workload: number, status: string}> {
        const available: Array<{person: Person, workload: number, status: string}> = [];
        
        availabilities.forEach((avail) => {
            if (avail.eventId === eventId && avail.serviceId === serviceId) {
                const person = persons.get(avail.userId);
                if (person) {
                    available.push({
                        person,
                        workload: getWorkload(avail.userId),
                        status: avail.status
                    });
                }
            }
        });

        // Sort by status (yes first) and workload
        available.sort((a, b) => {
            if (a.status === 'yes' && b.status !== 'yes') return -1;
            if (a.status !== 'yes' && b.status === 'yes') return 1;
            return a.workload - b.workload;
        });

        return available;
    }

    function getEventRoom(event: Event): string {
        // Extract room from event data
        return event.calendar?.title || 'Kein Raum';
    }

    function formatDateTime(dateString: string): { date: string, time: string } {
        const date = new Date(dateString);
        return {
            date: date.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }),
            time: date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
        };
    }

    function formatTimeRange(startDate: string, endDate?: string): string {
        const start = new Date(startDate);
        const startTime = start.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
        
        if (endDate) {
            const end = new Date(endDate);
            const endTime = end.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
            return `${startTime} – ${endTime}`;
        }
        
        return startTime;
    }

    function render() {
        element.innerHTML = `
            <div style="padding: 2rem; max-width: 1600px; margin: 0 auto;">
                ${renderScenarioSelector()}
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem;">
                    <h1 style="margin: 0; font-size: 1.8rem;">Dienstplanung – Veranstaltungen</h1>
                    ${renderFilters()}
                </div>

                ${
                    isLoading
                        ? `<div style="padding: 2rem; text-align: center; color: #666;"><p>Lade Daten...</p></div>`
                        : errorMessage
                          ? `<div style="padding: 1rem; background: #fee; border: 1px solid #fcc; border-radius: 4px; color: #c00;"><strong>Fehler:</strong> ${errorMessage}</div>`
                          : renderTable()
                }
            </div>
        `;

        if (!isLoading && !errorMessage) {
            attachEventHandlers();
        }
    }

    function renderScenarioSelector() {
        if (scenarios.length === 0) return '';
        
        return `
            <div style="background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 4px; padding: 1rem; margin-bottom: 1.5rem;">
                <label style="display: block; margin-bottom: 0.5rem; font-weight: 500;">
                    Planungsszenario:
                </label>
                <select 
                    id="scenario-selector" 
                    style="width: 100%; max-width: 400px; padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px; font-size: 1rem;"
                >
                    ${scenarios.map(scenario => `
                        <option value="${scenario.shortName}" ${currentScenario?.shortName === scenario.shortName ? 'selected' : ''}>
                            ${scenario.name} - ${scenario.description}
                        </option>
                    `).join('')}
                </select>
                ${currentScenario ? `
                    <div style="margin-top: 0.5rem; font-size: 0.85rem; color: #666;">
                        Kalender: ${currentScenario.calendarIds.length || 'Alle'} | 
                        Kategorien: ${currentScenario.serviceCategoryIds.length || 'Alle'} | 
                        Gruppen: ${currentScenario.serviceGroupIds.length || 'Alle'}
                    </div>
                ` : ''}
            </div>
        `;
    }

    function renderFilters() {
        return `
            <div style="display: flex; gap: 1rem; align-items: center;">
                <button style="padding: 0.5rem 1rem; border: 1px solid #ddd; border-radius: 4px; background: white; cursor: pointer;">
                    🏢 RAUM
                </button>
                <button style="padding: 0.5rem 1rem; border: 1px solid #ddd; border-radius: 4px; background: white; cursor: pointer;">
                    🕐 Zeit
                </button>
                <button style="padding: 0.5rem 1rem; border: 1px solid #ddd; border-radius: 4px; background: white; cursor: pointer;">
                    📅 Mehrfachauswahl Kalender
                </button>
                <button style="padding: 0.5rem 1rem; border: 1px solid #ddd; border-radius: 4px; background: white; cursor: pointer;">
                    ⚙️ Dienstkategorie
                </button>
            </div>
        `;
    }

    function renderTable() {
        // Filter events with requested services
        const eventsWithServices = events.filter(event => {
            const requestedServices = (event.eventServices || [])
                .filter(es => {
                    const service = services.find(s => s.id === es.serviceId);
                    return service && service !== undefined;
                });
            return requestedServices.length > 0;
        });

        if (eventsWithServices.length === 0) {
            return `
                <div style="padding: 2rem; text-align: center; color: #666; background: #f8f9fa; border-radius: 8px;">
                    <p>Keine Events mit angeforderten Diensten gefunden.</p>
                </div>
            `;
        }

        return `
            <div style="background: white; border: 1px solid #ddd; border-radius: 8px; overflow: hidden;">
                <div style="padding: 1rem; background: #f8f9fa; border-bottom: 1px solid #ddd; color: #666; font-size: 0.9rem;">
                    Geplante Einsätze – ${eventsWithServices.length} Termine
                </div>
                
                <table style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr style="background: #f8f9fa; border-bottom: 2px solid #ddd;">
                            <th style="padding: 0.75rem; text-align: left; font-weight: 500; color: #666; font-size: 0.9rem;">Termin</th>
                            <th style="padding: 0.75rem; text-align: left; font-weight: 500; color: #666; font-size: 0.9rem;">Veranstaltungsbezeichnung</th>
                            <th style="padding: 0.75rem; text-align: left; font-weight: 500; color: #666; font-size: 0.9rem;">Raum</th>
                            <th style="padding: 0.75rem; text-align: left; font-weight: 500; color: #666; font-size: 0.9rem;">Geplante Dienstbesetzung</th>
                            <th style="padding: 0.75rem; text-align: center; font-weight: 500; color: #666; font-size: 0.9rem;">Button Bereit</th>
                            <th style="padding: 0.75rem; text-align: left; font-weight: 500; color: #666; font-size: 0.9rem;">Mögliche Besetzung</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${eventsWithServices.map(event => renderEventRow(event)).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    function renderEventRow(event: Event) {
        const { date } = formatDateTime(event.startDate);
        const timeRange = formatTimeRange(event.startDate, event.endDate);
        const room = getEventRoom(event);

        // Get all requested services for this event in the category
        const requestedServices = (event.eventServices || [])
            .filter(es => {
                const service = services.find(s => s.id === es.serviceId);
                return service && service !== undefined;
            });

        // Count assigned services
        const assignedCount = requestedServices.filter(es => es.personId !== null).length;
        const totalCount = requestedServices.length;

        // Get all assigned persons
        const assignedPersons = requestedServices
            .filter(es => es.personId !== null)
            .map(es => ({
                personId: es.personId!,
                serviceId: es.serviceId,
                name: getPersonName(es.personId!)
            }));

        // Get all available persons across all services
        const allAvailablePersons = new Map<number, {person: Person, workload: number, maxStatus: string}>();
        
        requestedServices.forEach(es => {
            const available = getAvailablePersons(event.id, es.serviceId);
            available.forEach(item => {
                const existing = allAvailablePersons.get(item.person.id);
                if (!existing || item.status === 'yes') {
                    allAvailablePersons.set(item.person.id, {
                        person: item.person,
                        workload: item.workload,
                        maxStatus: item.status
                    });
                }
            });
        });

        const availableArray = Array.from(allAvailablePersons.values())
            .sort((a, b) => {
                if (a.maxStatus === 'yes' && b.maxStatus !== 'yes') return -1;
                if (a.maxStatus !== 'yes' && b.maxStatus === 'yes') return 1;
                return a.workload - b.workload;
            });

        return `
            <tr style="border-bottom: 1px solid #eee;">
                <td style="padding: 1rem; vertical-align: top;">
                    <div style="font-weight: 500;">${timeRange}</div>
                    <div style="font-size: 0.85rem; color: #666;">${date}</div>
                </td>
                <td style="padding: 1rem; vertical-align: top;">
                    <div style="font-weight: 500;">${event.name}</div>
                </td>
                <td style="padding: 1rem; vertical-align: top;">
                    ${room}
                </td>
                <td style="padding: 1rem; vertical-align: top;">
                    <div style="margin-bottom: 0.5rem; font-size: 0.85rem; color: #666;">
                        ${assignedCount} / ${totalCount} Dienste zugewiesen
                    </div>
                    <div style="display: flex; flex-wrap: wrap; gap: 0.5rem;">
                        ${assignedPersons.map(ap => `
                            <span style="display: inline-flex; align-items: center; gap: 0.25rem; padding: 0.25rem 0.5rem; background: #e3f2fd; border: 1px solid #90caf9; border-radius: 4px; font-size: 0.85rem;">
                                ${ap.name}
                                <button class="remove-assignment" data-event-id="${event.id}" data-service-id="${ap.serviceId}" style="border: none; background: none; cursor: pointer; padding: 0; margin-left: 0.25rem; color: #666;">✕</button>
                            </span>
                        `).join('')}
                        ${assignedPersons.length === 0 ? '<span style="color: #999; font-size: 0.85rem;">👤 –</span>' : ''}
                    </div>
                </td>
                <td style="padding: 1rem; text-align: center; vertical-align: top;">
                    <button style="padding: 0.5rem 1.5rem; background: #4caf50; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 500;">
                        Bereit
                    </button>
                </td>
                <td style="padding: 1rem; vertical-align: top;">
                    <div style="display: flex; flex-wrap: wrap; gap: 0.5rem;">
                        ${availableArray.slice(0, 6).map(item => {
                            const isHighPriority = item.maxStatus === 'yes';
                            return `
                                <button class="assign-person" data-event-id="${event.id}" data-person-id="${item.person.id}" 
                                    style="padding: 0.25rem 0.5rem; background: ${isHighPriority ? '#2196f3' : '#e0e0e0'}; 
                                           color: ${isHighPriority ? 'white' : '#666'}; border: none; border-radius: 4px; 
                                           cursor: pointer; font-size: 0.85rem; font-weight: 500;">
                                    ${item.person.firstName} ${item.person.lastName} (${item.workload})
                                </button>
                            `;
                        }).join('')}
                    </div>
                </td>
            </tr>
        `;
    }

    function attachEventHandlers() {
        // Scenario selector
        const scenarioSelector = element.querySelector('#scenario-selector') as HTMLSelectElement;
        if (scenarioSelector) {
            scenarioSelector.addEventListener('change', (e) => {
                const selectedId = (e.target as HTMLSelectElement).value;
                switchScenario(selectedId);
            });
        }
        
        // Remove assignment buttons
        const removeButtons = element.querySelectorAll('.remove-assignment');
        removeButtons.forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const target = e.target as HTMLButtonElement;
                const eventId = parseInt(target.dataset.eventId || '0');
                const serviceId = parseInt(target.dataset.serviceId || '0');
                
                // TODO: Implement remove assignment
                console.log('Remove assignment:', eventId, serviceId);
            });
        });

        // Assign person buttons
        const assignButtons = element.querySelectorAll('.assign-person');
        assignButtons.forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const target = e.target as HTMLButtonElement;
                const eventId = parseInt(target.dataset.eventId || '0');
                const personId = parseInt(target.dataset.personId || '0');
                
                // TODO: Implement assignment logic
                console.log('Assign person:', eventId, personId);
            });
        });
    }

    initialize();

    return () => {
        console.log('[Disponent-Table] Cleaning up');
    };
};

export { disponentTableEntryPoint };
export default disponentTableEntryPoint;
