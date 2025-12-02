import type { EntryPoint } from '../lib/main';
import type { MainModuleData } from '@churchtools/extension-points/main';
import { getModule, getCustomDataCategory, getCustomDataValues, createCustomDataValue, updateCustomDataValue, createCustomDataCategory } from '../utils/kv-store';

/**
 * Disponent Entry Point
 *
 * Zentrale Ansicht für Disponenten zur Zuweisung von Mitarbeitern zu Dienstanforderungen.
 * Zeigt Verfügbarkeiten aller Mitarbeiter und ermöglicht intelligente Zuweisungen.
 */

interface DienstplanungSettings {
    key: string;
    value: string;
}

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

const disponentEntryPoint: EntryPoint<MainModuleData> = ({ element, churchtoolsClient, KEY, user }) => {
    console.log('[Disponent] Initializing');
    console.log('[Disponent] Current user:', user);

    let scenarios: ScenarioConfig[] = [];
    let currentScenario: ScenarioConfig | null = null;
    let serviceCategoryId: string | null = null;
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
    let selectedServiceId: number | null = null;
    let dateRange: number = 28; // days

    // Initialize and load data
    async function initialize() {
        try {
            isLoading = true;
            render();

            // Load settings
            await loadSettings();

            if (!serviceCategoryId) {
                errorMessage = 'Keine Dienstkategorie konfiguriert. Bitte in den Admin-Einstellungen konfigurieren.';
                isLoading = false;
                render();
                return;
            }

            // Load all data
            await Promise.all([
                loadEvents(),
                loadServices(),
                loadAvailabilities(),
                loadAssignments(),
                loadPersons()
            ]);

            console.log('[Disponent] Loaded data:', {
                events: events.length,
                services: services.length,
                serviceCategoryId,
                eventsWithServices: events.filter(e => (e.eventServices || []).length > 0).length,
                persons: persons.size
            });

            isLoading = false;
            errorMessage = '';
            render();
        } catch (error) {
            console.error('[Disponent] Initialization error:', error);
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
            console.error('[Disponent] Failed to load scenarios:', error);
            return [];
        }
    }

    // Load service category from settings
    async function loadSettings(): Promise<void> {
        try {
            const extensionModule = await getModule(KEY);
            moduleId = extensionModule.id;

            // Load scenarios
            scenarios = await loadScenarios();
            
            if (scenarios.length > 0) {
                // Try to load saved scenario from localStorage
                const savedScenarioId = localStorage.getItem('bwl-dienstplanung-scenario');
                currentScenario = scenarios.find(s => s.shortName === savedScenarioId) || scenarios[0];
                console.log('[Disponent] Using scenario:', currentScenario.name);
            } else {
                // Fallback to old settings
                const settingsCategory = await getCustomDataCategory<object>('settings');
                if (!settingsCategory) {
                    console.log('[Disponent] No settings found');
                    return;
                }

                const values = await getCustomDataValues<DienstplanungSettings>(
                    settingsCategory.id,
                    extensionModule.id
                );

                const serviceCatValue = values.find((v) => v.key === 'serviceCategory');
                if (serviceCatValue) {
                    serviceCategoryId = serviceCatValue.value;
                    console.log('[Disponent] Loaded service category:', serviceCategoryId);
                }
            }
        } catch (error) {
            console.log('[Disponent] Could not load settings:', error);
        }
    }
    
    async function switchScenario(scenarioId: string) {
        const newScenario = scenarios.find(s => s.shortName === scenarioId);
        if (!newScenario) return;
        
        currentScenario = newScenario;
        localStorage.setItem('bwl-dienstplanung-scenario', scenarioId);
        console.log('[Disponent] Switched to scenario:', currentScenario.name);
        
        // Reload data
        await initialize();
    }

    // Load upcoming events with their requested services
    async function loadEvents(): Promise<void> {
        try {
            const today = new Date().toISOString().split('T')[0];
            const endDate = new Date();
            endDate.setDate(endDate.getDate() + dateRange);
            const end = endDate.toISOString().split('T')[0];
            
            console.log('[Disponent] Loading events from', today, 'to', end);
            const response = await churchtoolsClient.get(`/events?from=${today}&to=${end}&limit=100&include=eventServices`) as any;
            console.log('[Disponent] Events response:', response);
            let allEvents = response.data || response || [];
            
            // Filter events by scenario criteria
            if (currentScenario && currentScenario.calendarIds.length > 0) {
                events = allEvents.filter((event: Event) => {
                    const calendarId = event.calendar?.id || event.calendar?.domainIdentifier;
                    if (!calendarId) return false;
                    return currentScenario!.calendarIds.includes(Number(calendarId));
                });
                console.log(`[Disponent] Filtered ${allEvents.length} events to ${events.length} by calendar`);
            } else {
                events = allEvents;
            }
            console.log('[Disponent] Loaded events:', events.length);
        } catch (error) {
            console.error('[Disponent] Failed to load events:', error);
            events = [];
        }
    }

    // Load services for the configured category
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
                        console.error(`[Disponent] Failed to load services for category ${categoryId}:`, error);
                    }
                }
                
                // Filter by service groups if configured
                if (currentScenario.serviceGroupIds.length > 0) {
                    services = allServices.filter((service: Service) => {
                        return currentScenario!.serviceGroupIds.includes(service.serviceGroupId);
                    });
                    console.log(`[Disponent] Filtered ${allServices.length} services to ${services.length} by service groups`);
                } else {
                    services = allServices;
                }
            } else if (serviceCategoryId) {
                // Fallback to old behavior
                console.log('[Disponent] Loading services for category:', serviceCategoryId);
                const response = await churchtoolsClient.get(`/services?servicegroup_id=${serviceCategoryId}`) as any;
                services = response.data || response || [];
            } else {
                services = [];
            }
            console.log('[Disponent] Loaded services:', services.length);
        } catch (error) {
            console.error('[Disponent] Failed to load services:', error);
            services = [];
        }
    }

    // Load availabilities from key-value store
    async function loadAvailabilities(): Promise<void> {
        try {
            if (!moduleId) return;

            let category = await getCustomDataCategory<object>('availabilities');
            if (!category) {
                console.log('[Disponent] No availabilities category found');
                return;
            }
            availabilityCategory = category;

            const values = await getCustomDataValues<Availability>(category.id, moduleId);
            
            availabilities.clear();
            values.forEach(val => {
                const key = `${val.eventId}-${val.serviceId}-${val.userId}`;
                availabilities.set(key, val);
            });

            console.log('[Disponent] Loaded availabilities:', availabilities.size);
        } catch (error) {
            console.error('[Disponent] Failed to load availabilities:', error);
        }
    }

    // Load assignments from key-value store
    async function loadAssignments(): Promise<void> {
        try {
            if (!moduleId) return;

            let category = await getCustomDataCategory<object>('assignments');
            if (!category) {
                // Create category if it doesn't exist
                category = await createCustomDataCategory({
                    customModuleId: moduleId,
                    name: 'Assignments',
                    shorty: 'assignments',
                    description: 'Service assignments by dispatcher',
                }, moduleId);
            }
            assignmentCategory = category;

            const values = await getCustomDataValues<Assignment>(category.id, moduleId);
            
            assignments.clear();
            values.forEach(val => {
                const key = `${val.eventId}-${val.serviceId}`;
                assignments.set(key, val);
            });

            console.log('[Disponent] Loaded assignments:', assignments.size);
        } catch (error) {
            console.error('[Disponent] Failed to load assignments:', error);
        }
    }

    // Load persons
    async function loadPersons(): Promise<void> {
        try {
            const response = await churchtoolsClient.get('/persons?limit=500') as any;
            const personList = response.data || [];
            
            persons.clear();
            personList.forEach((p: Person) => {
                persons.set(p.id, p);
            });

            console.log('[Disponent] Loaded persons:', persons.size);
        } catch (error) {
            console.error('[Disponent] Failed to load persons:', error);
        }
    }

    // Assign person to service
    async function assignPerson(eventId: number, serviceId: number, userId: number, isExternal: boolean = false, externalName?: string): Promise<void> {
        if (!moduleId || !user?.id || !assignmentCategory) {
            throw new Error('Not initialized');
        }

        const assignment: Assignment = {
            eventId,
            serviceId,
            userId,
            assignedBy: user.id,
            assignedAt: new Date().toISOString(),
            status: 'assigned',
            isExternal,
            externalName,
        };

        const key = `${eventId}-${serviceId}`;
        const existing = assignments.get(key);

        const valueData = JSON.stringify(assignment);

        if (existing && (existing as any).id) {
            // Update existing
            await updateCustomDataValue(
                assignmentCategory.id,
                (existing as any).id,
                { value: valueData },
                moduleId
            );
        } else {
            // Create new
            await createCustomDataValue({
                dataCategoryId: assignmentCategory.id,
                value: valueData,
            }, moduleId);
        }

        assignments.set(key, assignment);
        render();
    }

    // Get availabilities for event/service
    function getAvailabilitiesForService(eventId: number, serviceId: number): { available: Availability[], maybe: Availability[], unavailable: Availability[] } {
        const available: Availability[] = [];
        const maybe: Availability[] = [];
        const unavailable: Availability[] = [];

        availabilities.forEach((avail) => {
            if (avail.eventId === eventId && avail.serviceId === serviceId) {
                if (avail.status === 'yes') {
                    available.push(avail);
                } else if (avail.status === 'maybe') {
                    maybe.push(avail);
                } else {
                    unavailable.push(avail);
                }
            }
        });

        return { available, maybe, unavailable };
    }

    // Get assignment for event/service
    function getAssignment(eventId: number, serviceId: number): Assignment | null {
        const key = `${eventId}-${serviceId}`;
        return assignments.get(key) || null;
    }

    // Get person name
    function getPersonName(userId: number): string {
        const person = persons.get(userId);
        if (!person) return `User ${userId}`;
        return `${person.firstName} ${person.lastName}`;
    }

    // Calculate workload for person
    function getWorkload(userId: number): number {
        let count = 0;
        assignments.forEach((assignment) => {
            if (assignment.userId === userId) {
                count++;
            }
        });
        return count;
    }

    // Format date
    function formatDate(dateString: string): string {
        const date = new Date(dateString);
        return date.toLocaleDateString('de-DE', {
            weekday: 'short',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    // Render UI
    function render() {
        element.innerHTML = `
            <div style="padding: 2rem; max-width: 1400px; margin: 0 auto;">
                <h1 style="margin: 0 0 1.5rem 0; font-size: 1.8rem;">Dienstplanung - Disponent</h1>
                ${renderScenarioSelector()}

                ${
                    isLoading
                        ? `
                    <div style="padding: 2rem; text-align: center; color: #666;">
                        <p>Lade Daten...</p>
                    </div>
                `
                        : errorMessage
                          ? `
                    <div style="padding: 1rem; background: #fee; border: 1px solid #fcc; border-radius: 4px; color: #c00;">
                        <strong>Fehler:</strong> ${errorMessage}
                    </div>
                `
                          : renderContent()
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

    function renderContent() {
        if (events.length === 0) {
            return `
                <div style="padding: 2rem; text-align: center; color: #666; background: #f8f9fa; border-radius: 8px;">
                    <p>Keine anstehenden Events gefunden.</p>
                </div>
            `;
        }

        // Filter events that have requested services in the configured category
        const eventsWithServices = events.filter(event => {
            const requestedServices = (event.eventServices || [])
                .filter(es => {
                    const service = services.find(s => s.id === es.serviceId);
                    return service && service.serviceGroupId.toString() === serviceCategoryId;
                });
            
            // Apply service filter if selected
            if (selectedServiceId) {
                return requestedServices.some(es => es.serviceId === selectedServiceId);
            }
            
            return requestedServices.length > 0;
        });

        if (eventsWithServices.length === 0) {
            return `
                ${renderFilters()}
                <div style="padding: 2rem; text-align: center; color: #666; background: #f8f9fa; border-radius: 8px; margin-top: 1.5rem;">
                    <p>Keine Events mit angeforderten Diensten in der ausgewählten Kategorie gefunden.</p>
                    <p style="margin-top: 0.5rem; font-size: 0.9rem; color: #999;">
                        Tipp: Prüfen Sie, ob Events Dienste aus der ausgewählten Kategorie anfordern.
                    </p>
                </div>
            `;
        }

        return `
            ${renderFilters()}
            <div style="display: flex; flex-direction: column; gap: 1.5rem; margin-top: 1.5rem;">
                ${eventsWithServices.map(event => renderEvent(event)).join('')}
            </div>
        `;
    }

    function renderFilters() {
        return `
            <div style="background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 1rem; margin-bottom: 1rem;">
                <div style="display: flex; gap: 1rem; align-items: center;">
                    <label style="font-weight: 500;">Dienst:</label>
                    <select id="service-filter" style="padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px;">
                        <option value="">Alle Dienste</option>
                        ${services.map(s => `<option value="${s.id}" ${selectedServiceId === s.id ? 'selected' : ''}>${s.name}</option>`).join('')}
                    </select>
                    
                    <label style="font-weight: 500; margin-left: 1rem;">Zeitraum:</label>
                    <select id="date-range-filter" style="padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px;">
                        <option value="7" ${dateRange === 7 ? 'selected' : ''}>Nächste 7 Tage</option>
                        <option value="14" ${dateRange === 14 ? 'selected' : ''}>Nächste 14 Tage</option>
                        <option value="28" ${dateRange === 28 ? 'selected' : ''}>Nächste 4 Wochen</option>
                        <option value="90" ${dateRange === 90 ? 'selected' : ''}>Nächste 3 Monate</option>
                    </select>
                </div>
            </div>
        `;
    }

    function renderEvent(event: Event) {
        // Get requested services for this event (only services in the configured category)
        const requestedServices = (event.eventServices || [])
            .filter(es => {
                const service = services.find(s => s.id === es.serviceId);
                return service && service.serviceGroupId.toString() === serviceCategoryId;
            })
            .map(es => services.find(s => s.id === es.serviceId))
            .filter(s => s !== undefined);

        // Apply service filter if selected
        const filteredServices = selectedServiceId 
            ? requestedServices.filter(s => s!.id === selectedServiceId)
            : requestedServices;

        if (filteredServices.length === 0) return '';

        return `
            <div style="background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 1.5rem;">
                <div style="margin-bottom: 1rem;">
                    <h2 style="margin: 0 0 0.5rem 0; font-size: 1.3rem;">${event.name}</h2>
                    <p style="margin: 0; color: #666; font-size: 0.9rem;">
                        📅 ${formatDate(event.startDate)}
                    </p>
                </div>

                <div style="display: flex; flex-direction: column; gap: 1rem;">
                    ${filteredServices.map(service => renderServiceAssignment(event, service!)).join('')}
                </div>
            </div>
        `;
    }

    function renderServiceAssignment(event: Event, service: Service) {
        const { available, maybe, unavailable } = getAvailabilitiesForService(event.id, service.id);
        const assignment = getAssignment(event.id, service.id);

        return `
            <div style="border: 1px solid #e0e0e0; border-radius: 6px; padding: 1rem; background: #fafafa;">
                <div style="display: flex; justify-content: space-between; align-items: start;">
                    <div style="flex: 1;">
                        <h3 style="margin: 0 0 0.75rem 0; font-size: 1.1rem; color: #333;">
                            ${service.name}
                        </h3>

                        ${assignment ? `
                            <div style="padding: 0.75rem; background: #e3f2fd; border-left: 4px solid #2196f3; border-radius: 4px; margin-bottom: 0.75rem;">
                                <strong>🔵 Zugeteilt:</strong> ${assignment.isExternal ? assignment.externalName : getPersonName(assignment.userId)}
                                ${assignment.isExternal ? ' (Extern)' : ''}
                            </div>
                        ` : ''}

                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 0.75rem;">
                            ${available.length > 0 ? `
                                <div>
                                    <strong style="color: #28a745;">🟢 Verfügbar (${available.length}):</strong>
                                    <ul style="margin: 0.25rem 0 0 0; padding-left: 1.25rem; font-size: 0.9rem;">
                                        ${available.map(a => `
                                            <li>
                                                ${getPersonName(a.userId)} 
                                                <span style="color: #999;">(Auslastung: ${getWorkload(a.userId)})</span>
                                            </li>
                                        `).join('')}
                                    </ul>
                                </div>
                            ` : ''}

                            ${maybe.length > 0 ? `
                                <div>
                                    <strong style="color: #ffc107;">🟡 Vielleicht (${maybe.length}):</strong>
                                    <ul style="margin: 0.25rem 0 0 0; padding-left: 1.25rem; font-size: 0.9rem;">
                                        ${maybe.map(a => `
                                            <li>
                                                ${getPersonName(a.userId)}
                                                <span style="color: #999;">(Auslastung: ${getWorkload(a.userId)})</span>
                                            </li>
                                        `).join('')}
                                    </ul>
                                </div>
                            ` : ''}

                            ${unavailable.length > 0 ? `
                                <div>
                                    <strong style="color: #dc3545;">🔴 Nicht verfügbar (${unavailable.length}):</strong>
                                    <ul style="margin: 0.25rem 0 0 0; padding-left: 1.25rem; font-size: 0.9rem;">
                                        ${unavailable.map(a => `<li>${getPersonName(a.userId)}</li>`).join('')}
                                    </ul>
                                </div>
                            ` : ''}
                        </div>
                    </div>

                    <div style="margin-left: 1rem; min-width: 250px;">
                        <label style="display: block; margin-bottom: 0.5rem; font-weight: 500;">Zuweisen:</label>
                        <select 
                            class="assign-select" 
                            data-event-id="${event.id}" 
                            data-service-id="${service.id}"
                            style="width: 100%; padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px; margin-bottom: 0.5rem;"
                        >
                            <option value="">-- Person auswählen --</option>
                            <optgroup label="Verfügbar">
                                ${available.map(a => `
                                    <option value="${a.userId}">
                                        ${getPersonName(a.userId)} (${getWorkload(a.userId)})
                                    </option>
                                `).join('')}
                            </optgroup>
                            ${maybe.length > 0 ? `
                                <optgroup label="Vielleicht">
                                    ${maybe.map(a => `
                                        <option value="${a.userId}">
                                            ${getPersonName(a.userId)} (${getWorkload(a.userId)})
                                        </option>
                                    `).join('')}
                                </optgroup>
                            ` : ''}
                        </select>
                        <button 
                            class="assign-btn"
                            data-event-id="${event.id}" 
                            data-service-id="${service.id}"
                            style="width: 100%; padding: 0.5rem; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 500;"
                        >
                            Zuweisen
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    // Attach event handlers
    function attachEventHandlers() {
        // Scenario selector
        const scenarioSelector = element.querySelector('#scenario-selector') as HTMLSelectElement;
        if (scenarioSelector) {
            scenarioSelector.addEventListener('change', (e) => {
                const selectedId = (e.target as HTMLSelectElement).value;
                switchScenario(selectedId);
            });
        }
        
        // Filter handlers
        const serviceFilter = element.querySelector('#service-filter') as HTMLSelectElement;
        const dateRangeFilter = element.querySelector('#date-range-filter') as HTMLSelectElement;

        if (serviceFilter) {
            serviceFilter.addEventListener('change', async (e) => {
                const value = (e.target as HTMLSelectElement).value;
                selectedServiceId = value ? parseInt(value) : null;
                render();
            });
        }

        if (dateRangeFilter) {
            dateRangeFilter.addEventListener('change', async (e) => {
                const value = (e.target as HTMLSelectElement).value;
                dateRange = parseInt(value);
                await loadEvents();
                render();
            });
        }

        // Assignment handlers
        const assignButtons = element.querySelectorAll('.assign-btn');
        assignButtons.forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const target = e.target as HTMLButtonElement;
                const eventId = parseInt(target.dataset.eventId || '0');
                const serviceId = parseInt(target.dataset.serviceId || '0');
                
                const select = element.querySelector(
                    `.assign-select[data-event-id="${eventId}"][data-service-id="${serviceId}"]`
                ) as HTMLSelectElement;

                if (!select || !select.value) {
                    alert('Bitte wählen Sie eine Person aus.');
                    return;
                }

                const userId = parseInt(select.value);

                try {
                    target.disabled = true;
                    target.textContent = 'Zuweisen...';
                    await assignPerson(eventId, serviceId, userId);
                    alert('Zuweisung erfolgreich!');
                } catch (error) {
                    console.error('[Disponent] Failed to assign:', error);
                    alert('Fehler bei der Zuweisung');
                } finally {
                    target.disabled = false;
                    target.textContent = 'Zuweisen';
                }
            });
        });
    }

    // Initialize on load
    initialize();

    // Cleanup function
    return () => {
        console.log('[Disponent] Cleaning up');
    };
};

// Named export for simple mode
export { disponentEntryPoint };

// Default export for advanced mode
export default disponentEntryPoint;
