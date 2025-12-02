import type { EntryPoint } from '../lib/main';
import type { MainModuleData } from '@churchtools/extension-points/main';
import { getModule, getCustomDataCategory, getCustomDataValues, createCustomDataValue, updateCustomDataValue, createCustomDataCategory } from '../utils/kv-store';

/**
 * Main Module Entry Point - Dienstplanung
 *
 * Zeigt ChurchTools-Events an mit angeforderten Diensten.
 * Ermöglicht Dienstbesetzern die Meldung ihrer Verfügbarkeit (Ja/Vielleicht/Nein).
 */

interface DienstplanungSettings {
    key: string;
    value: string;
}

interface ScenarioConfig {
    id: string;
    name: string;
    description: string;
    calendarIds: number[];
    serviceCategoryIds: number[];
    serviceGroupIds: number[];
    disponentPermissions: number[];
    mitarbeiterPermissions: number[];
    createdAt: string;
    createdBy: number;
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
    status: 'yes' | 'maybe' | 'no';
    timestamp: string;
}

const mainEntryPoint: EntryPoint<MainModuleData> = ({ element, churchtoolsClient, KEY, user }) => {
    console.log('[Dienstplanung] Initializing');
    console.log('[Dienstplanung] Current user:', user);

    let scenarios: ScenarioConfig[] = [];
    let currentScenario: ScenarioConfig | null = null;
    let serviceCategoryId: string | null = null;
    let events: Event[] = [];
    let services: Service[] = [];
    let availabilities: Map<string, Availability> = new Map();
    let isLoading = true;
    let errorMessage = '';
    let moduleId: number | null = null;
    let availabilityCategory: any = null;

    // Initialize and load data
    async function initialize() {
        try {
            isLoading = true;
            render();

            // Load service category from settings
            await loadSettings();

            if (!serviceCategoryId) {
                errorMessage = 'Keine Dienstkategorie konfiguriert. Bitte in den Admin-Einstellungen konfigurieren.';
                isLoading = false;
                render();
                return;
            }

            // Load events and services
            await Promise.all([
                loadEvents(),
                loadServices(),
                loadAvailabilities()
            ]);

            console.log('[Dienstplanung] Loaded data:', {
                events: events.length,
                services: services.length,
                serviceCategoryId,
                eventsWithServices: events.filter(e => (e.eventServices || []).length > 0).length
            });

            isLoading = false;
            errorMessage = '';
            render();
        } catch (error) {
            console.error('[Dienstplanung] Initialization error:', error);
            isLoading = false;
            errorMessage = error instanceof Error ? error.message : 'Fehler beim Laden';
            render();
        }
    }

    // Load service category from settings
    async function loadScenarios(): Promise<ScenarioConfig[]> {
        try {
            const extensionModule = await getModule(KEY);
            const category = await getCustomDataCategory<object>('scenarios');
            
            if (!category) return [];
            
            return await getCustomDataValues<ScenarioConfig>(category.id, extensionModule.id);
        } catch (error) {
            console.error('[Dienstplanung] Failed to load scenarios:', error);
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
                const savedScenarioId = localStorage.getItem('bwl-dienstplanung-scenario');
                currentScenario = scenarios.find(s => s.id === savedScenarioId) || scenarios[0];
                console.log('[Dienstplanung] Using scenario:', currentScenario.name);
            } else {
                // Fallback to old settings
                const settingsCategory = await getCustomDataCategory<object>('settings');
                if (!settingsCategory) {
                    console.log('[Dienstplanung] No settings found');
                    return;
                }

                const values = await getCustomDataValues<DienstplanungSettings>(
                    settingsCategory.id,
                    extensionModule.id
                );

                const serviceCatValue = values.find((v) => v.key === 'serviceCategory');
                if (serviceCatValue) {
                    serviceCategoryId = serviceCatValue.value;
                    console.log('[Dienstplanung] Loaded service category:', serviceCategoryId);
                }
            }
        } catch (error) {
            console.log('[Dienstplanung] Could not load settings:', error);
        }
    }
    
    async function switchScenario(scenarioId: string) {
        const newScenario = scenarios.find(s => s.id === scenarioId);
        if (!newScenario) return;
        
        currentScenario = newScenario;
        localStorage.setItem('bwl-dienstplanung-scenario', scenarioId);
        console.log('[Dienstplanung] Switched to scenario:', currentScenario.name);
        
        // Reload data
        await initialize();
    }

    // Load upcoming events with their requested services
    async function loadEvents(): Promise<void> {
        try {
            const today = new Date().toISOString().split('T')[0];
            console.log('[Dienstplanung] Loading events from', today);
            const response = await churchtoolsClient.get(`/events?from=${today}&limit=50&include=eventServices`);
            console.log('[Dienstplanung] Events response:', response);
            let allEvents = response.data || response || [];
            
            // Filter events by scenario criteria
            if (currentScenario && currentScenario.calendarIds.length > 0) {
                events = allEvents.filter((event: Event) => {
                    const calendarId = event.calendar?.id || event.calendar?.domainIdentifier;
                    if (!calendarId) return false;
                    return currentScenario!.calendarIds.includes(Number(calendarId));
                });
                console.log(`[Dienstplanung] Filtered ${allEvents.length} events to ${events.length} by calendar`);
            } else {
                events = allEvents;
            }
            console.log('[Dienstplanung] Loaded events:', events.length);
        } catch (error) {
            console.error('[Dienstplanung] Failed to load events:', error);
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
                        const response = await churchtoolsClient.get(`/services?servicegroup_id=${categoryId}`);
                        const categoryServices = response.data || response || [];
                        allServices.push(...categoryServices);
                    } catch (error) {
                        console.error(`[Dienstplanung] Failed to load services for category ${categoryId}:`, error);
                    }
                }
                
                // Filter by service groups if configured
                if (currentScenario.serviceGroupIds.length > 0) {
                    services = allServices.filter((service: Service) => {
                        return currentScenario!.serviceGroupIds.includes(service.serviceGroupId);
                    });
                    console.log(`[Dienstplanung] Filtered ${allServices.length} services to ${services.length} by service groups`);
                } else {
                    services = allServices;
                }
            } else if (serviceCategoryId) {
                // Fallback to old behavior
                console.log('[Dienstplanung] Loading services for category:', serviceCategoryId);
                const response = await churchtoolsClient.get(`/services?servicegroup_id=${serviceCategoryId}`);
                services = response.data || response || [];
            } else {
                services = [];
            }
            console.log('[Dienstplanung] Loaded services:', services.length);
        } catch (error) {
            console.error('[Dienstplanung] Failed to load services:', error);
            services = [];
        }
    }

    // Load availabilities from key-value store
    async function loadAvailabilities(): Promise<void> {
        try {
            if (!moduleId) return;

            // Get or create availability category
            let category = await getCustomDataCategory<object>('availabilities');
            if (!category) {
                console.log('[Dienstplanung] No availabilities category found');
                return;
            }
            availabilityCategory = category;

            const values = await getCustomDataValues<Availability>(category.id, moduleId);
            
            availabilities.clear();
            values.forEach(val => {
                const key = `${val.eventId}-${val.serviceId}-${val.userId}`;
                availabilities.set(key, val);
            });

            console.log('[Dienstplanung] Loaded availabilities:', availabilities.size);
        } catch (error) {
            console.error('[Dienstplanung] Failed to load availabilities:', error);
        }
    }

    // Save availability
    async function saveAvailability(eventId: number, serviceId: number, status: 'yes' | 'maybe' | 'no'): Promise<void> {
        if (!moduleId || !user?.id) {
            throw new Error('Not initialized or user not available');
        }

        // Ensure availability category exists
        if (!availabilityCategory) {
            availabilityCategory = await createCustomDataCategory({
                customModuleId: moduleId,
                name: 'Availabilities',
                shorty: 'availabilities',
                description: 'User availability responses',
            }, moduleId);
        }

        const availability: Availability = {
            eventId,
            serviceId,
            userId: user.id,
            status,
            timestamp: new Date().toISOString(),
        };

        const key = `${eventId}-${serviceId}-${user.id}`;
        const existing = availabilities.get(key);

        const valueData = JSON.stringify(availability);

        if (existing && (existing as any).id) {
            // Update existing
            await updateCustomDataValue(
                availabilityCategory.id,
                (existing as any).id,
                { value: valueData },
                moduleId
            );
        } else {
            // Create new
            await createCustomDataValue({
                dataCategoryId: availabilityCategory.id,
                value: valueData,
            }, moduleId);
        }

        availabilities.set(key, availability);
        render();
    }

    // Get availability for event/service/user
    function getAvailability(eventId: number, serviceId: number): 'yes' | 'maybe' | 'no' | null {
        if (!user?.id) return null;
        const key = `${eventId}-${serviceId}-${user.id}`;
        return availabilities.get(key)?.status || null;
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
            <div style="padding: 2rem; max-width: 1200px; margin: 0 auto;">
                <h1 style="margin: 0 0 1.5rem 0; font-size: 1.8rem;">Dienstplanung - Mitarbeiter</h1>
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
            return requestedServices.length > 0;
        });

        if (eventsWithServices.length === 0) {
            return `
                <div style="padding: 2rem; text-align: center; color: #666; background: #f8f9fa; border-radius: 8px;">
                    <p>Keine Events mit angeforderten Diensten in der ausgewählten Kategorie gefunden.</p>
                    <p style="margin-top: 0.5rem; font-size: 0.9rem; color: #999;">
                        Tipp: Prüfen Sie, ob Events Dienste aus der Kategorie "${services[0]?.name || 'ausgewählt'}" anfordern.
                    </p>
                </div>
            `;
        }

        return `
            <div style="display: flex; flex-direction: column; gap: 1.5rem;">
                ${eventsWithServices.map(event => renderEvent(event)).join('')}
            </div>
        `;
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
                        <option value="${scenario.id}" ${currentScenario?.id === scenario.id ? 'selected' : ''}>
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

    function renderEvent(event: Event) {
        // Get requested services for this event (only services in the configured category)
        const requestedServices = (event.eventServices || [])
            .filter(es => {
                const service = services.find(s => s.id === es.serviceId);
                return service && service.serviceGroupId.toString() === serviceCategoryId;
            })
            .map(es => {
                const service = services.find(s => s.id === es.serviceId);
                return { eventService: es, service };
            })
            .filter(item => item.service);

        if (requestedServices.length === 0) {
            return ''; // Don't show events without requested services in this category
        }

        return `
            <div style="background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 1.5rem;">
                <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 1rem;">
                    <div>
                        <h2 style="margin: 0 0 0.5rem 0; font-size: 1.3rem;">${event.name}</h2>
                        <p style="margin: 0; color: #666; font-size: 0.9rem;">
                            ${formatDate(event.startDate)}
                        </p>
                    </div>
                </div>

                <div style="display: flex; flex-direction: column; gap: 0.75rem;">
                    ${requestedServices.map(item => renderService(event, item.service!, item.eventService)).join('')}
                </div>
            </div>
        `;
    }

    function renderService(event: Event, service: Service, eventService: EventService) {
        const availability = getAvailability(event.id, service.id);
        const isAssigned = eventService.personId !== null;
        
        return `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.75rem; background: ${isAssigned ? '#e3f2fd' : '#f8f9fa'}; border-radius: 4px; ${isAssigned ? 'border-left: 4px solid #2196f3;' : ''}">
                <div>
                    <span style="font-weight: 500;">${service.name}</span>
                    ${isAssigned ? `<span style="margin-left: 0.5rem; color: #2196f3; font-size: 0.9rem;">🔵 Bereits zugeteilt</span>` : ''}
                </div>
                <div style="display: flex; gap: 0.5rem;">
                    <button
                        class="availability-btn"
                        data-event-id="${event.id}"
                        data-service-id="${service.id}"
                        data-status="yes"
                        style="padding: 0.5rem 1rem; border: 2px solid ${availability === 'yes' ? '#28a745' : '#ddd'}; 
                               background: ${availability === 'yes' ? '#28a745' : '#fff'}; 
                               color: ${availability === 'yes' ? '#fff' : '#333'}; 
                               border-radius: 4px; cursor: pointer; font-weight: 500; transition: all 0.2s;"
                    >
                        ✓ Ja
                    </button>
                    <button
                        class="availability-btn"
                        data-event-id="${event.id}"
                        data-service-id="${service.id}"
                        data-status="maybe"
                        style="padding: 0.5rem 1rem; border: 2px solid ${availability === 'maybe' ? '#ffc107' : '#ddd'}; 
                               background: ${availability === 'maybe' ? '#ffc107' : '#fff'}; 
                               color: ${availability === 'maybe' ? '#fff' : '#333'}; 
                               border-radius: 4px; cursor: pointer; font-weight: 500; transition: all 0.2s;"
                    >
                        ? Vielleicht
                    </button>
                    <button
                        class="availability-btn"
                        data-event-id="${event.id}"
                        data-service-id="${service.id}"
                        data-status="no"
                        style="padding: 0.5rem 1rem; border: 2px solid ${availability === 'no' ? '#dc3545' : '#ddd'}; 
                               background: ${availability === 'no' ? '#dc3545' : '#fff'}; 
                               color: ${availability === 'no' ? '#fff' : '#333'}; 
                               border-radius: 4px; cursor: pointer; font-weight: 500; transition: all 0.2s;"
                    >
                        ✗ Nein
                    </button>
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
        
        const buttons = element.querySelectorAll('.availability-btn');
        buttons.forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const target = e.target as HTMLButtonElement;
                const eventId = parseInt(target.dataset.eventId || '0');
                const serviceId = parseInt(target.dataset.serviceId || '0');
                const status = target.dataset.status as 'yes' | 'maybe' | 'no';

                try {
                    target.disabled = true;
                    await saveAvailability(eventId, serviceId, status);
                } catch (error) {
                    console.error('[Dienstplanung] Failed to save availability:', error);
                    alert('Fehler beim Speichern der Verfügbarkeit');
                } finally {
                    target.disabled = false;
                }
            });
        });
    }

    // Initialize on load
    initialize();

    // Cleanup function
    return () => {
        console.log('[Dienstplanung] Cleaning up');
    };
};

// Named export for simple mode
export { mainEntryPoint };

// Default export for advanced mode
export default mainEntryPoint;
