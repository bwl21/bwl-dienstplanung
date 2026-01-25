import type { EntryPoint } from '../lib/main';
import type { AdminData } from '@churchtools/extension-points/admin';
import type { CustomModuleDataCategory, CustomModuleDataValue } from '../utils/ct-types';
import {
    getOrCreateModule,
    getCustomDataCategory,
    createCustomDataCategory,
    getCustomDataValues,
    createCustomDataValue,
    updateCustomDataValue,
} from '../utils/kv-store';

/**
 * Admin Configuration Entry Point
 *
 * Konfiguration der Dienstkategorie für die Dienstplanung.
 * Einstellungen werden im ChurchTools Key-Value Store gespeichert.
 */

interface DienstplanungSettings {
    key: string;
    value: string;
}

interface ScenarioConfig {
    shortName: string; // Kurzname/Referenzname (z.B. "service")
    name: string;
    description: string;
    calendarIds: number[];
    serviceCategoryIds: number[];
    serviceGroupIds: number[];
    disponentPermissions: number[];
    mitarbeiterPermissions: number[];
    createdAt: string;
    createdBy: number;
    // Metadata from Custom Data Value (added by kv-store):
    id?: number; // Technical ID
    dataCategoryId?: number;
}

const adminEntryPoint: EntryPoint<AdminData> = ({ data, emit, element, KEY, churchtoolsClient }) => {
    console.log('[Admin] Initializing Dienstplanung Settings');
    console.log('[Admin] Extension info:', data.extensionInfo);

    let moduleId: number | null = null;
    let settingsCategory: CustomModuleDataCategory | null = null;
    let serviceCategoryValue: CustomModuleDataValue | null = null;
    let currentServiceCategoryId = '';
    let serviceCategories: any[] = [];
    
    // Scenario management
    let scenarios: ScenarioConfig[] = [];
    let calendars: any[] = [];
    let serviceGroups: any[] = [];
    let currentView: 'legacy' | 'scenarios' = 'scenarios';
    let showModal = false;
    let editingScenario: ScenarioConfig | null = null;
    let scenarioFilter = '';
    let modalSelectedCalendars: number[] = [];
    let modalSelectedCategories: number[] = [];
    let modalSelectedGroups: number[] = [];

    // UI State
    let isLoading = true;
    let errorMessage = '';

    // Initialize and load settings
    async function initialize() {
        try {
            isLoading = true;
            render();

            // Step 1: Get the extension module
            const extensionModule = await getOrCreateModule(
                KEY,
                data.extensionInfo?.name || 'Dienstplanung',
                data.extensionInfo?.description || 'Dienstplanung Extension'
            );
            moduleId = extensionModule.id;
            console.log('[Admin] Extension module:', extensionModule);

            // Step 2: Load ChurchTools data
            await Promise.all([
                loadServiceCategories(),
                loadCalendars(),
                loadScenarios()
            ]);

            // Step 3: Get or create the settings category (legacy)
            settingsCategory = await getOrCreateSettingsCategory();
            console.log('[Admin] Settings category:', settingsCategory);

            // Step 4: Load service category setting (legacy)
            await loadServiceCategorySetting(settingsCategory.id);

            isLoading = false;
            errorMessage = '';
            render();
        } catch (error) {
            console.error('[Admin] Initialization error:', error);
            isLoading = false;
            errorMessage = error instanceof Error ? error.message : 'Failed to initialize';
            render();
        }
    }
    
    async function loadCalendars() {
        try {
            const response = await churchtoolsClient.get('/calendars') as any;
            calendars = response.data || response || [];
            console.log('[Admin] Calendars loaded:', calendars.length);
        } catch (error) {
            console.error('[Admin] Failed to load calendars:', error);
            calendars = [];
        }
    }
    
    async function loadScenarios() {
        try {
            if (!moduleId) return;
            
            const category = await getCustomDataCategory<object>('scenarios');
            if (!category) {
                scenarios = [];
                return;
            }
            
            const values = await getCustomDataValues<ScenarioConfig>(category.id, moduleId);
            scenarios = values;
            console.log('[Admin] Scenarios loaded:', scenarios.length, scenarios);
        } catch (error) {
            console.error('[Admin] Failed to load scenarios:', error);
            scenarios = [];
        }
    }

    // Load service categories from ChurchTools API
    async function loadServiceCategories() {
        try {
            console.log('[Admin] Loading service categories...');
            const response = await churchtoolsClient.get('/event/masterdata') as any;
            console.log('[Admin] Raw response:', response);
            
            // ChurchTools API returns data directly or wrapped in data property
            if (response.serviceGroups) {
                serviceCategories = response.serviceGroups;
            } else if (response.data?.serviceGroups) {
                serviceCategories = response.data.serviceGroups;
            } else {
                console.warn('[Admin] No serviceGroups found in response');
                serviceCategories = [];
            }
            
            console.log('[Admin] Service categories loaded:', serviceCategories.length, serviceCategories);
        } catch (error) {
            console.error('[Admin] Failed to load service categories:', error);
            serviceCategories = [];
        }
    }
    
    async function loadServicesForCategories(categoryIds: number[]) {
        try {
            const allServices: any[] = [];
            for (const categoryId of categoryIds) {
                const response = await churchtoolsClient.get(`/services?servicegroup_id=${categoryId}`) as any;
                const categoryServices = response.data || response || [];
                allServices.push(...categoryServices);
            }
            
            // Extract unique service groups
            const groupIds = new Set<number>();
            allServices.forEach((service: any) => {
                if (service.serviceGroupId) {
                    groupIds.add(service.serviceGroupId);
                }
            });
            
            // Get service group details
            serviceGroups = Array.from(groupIds).map(id => {
                const service = allServices.find((s: any) => s.serviceGroupId === id);
                return {
                    id,
                    name: service?.serviceGroupName || `Gruppe ${id}`,
                    categoryId: service?.serviceGroupId
                };
            });
            
            console.log('[Admin] Service groups loaded:', serviceGroups);
        } catch (error) {
            console.error('[Admin] Failed to load services:', error);
            serviceGroups = [];
        }
    }

    // Get or create the "settings" category
    async function getOrCreateSettingsCategory(): Promise<CustomModuleDataCategory> {
        // Try to get existing settings category
        const existing = await getCustomDataCategory<object>('settings');
        if (existing) {
            return existing;
        }

        console.log('[Admin] Creating settings category');

        // Create settings category
        const created = await createCustomDataCategory({
            customModuleId: moduleId!,
            name: 'Settings',
            shorty: 'settings',
            description: 'Extension configuration settings',
        }, moduleId!);

        if (!created) {
            throw new Error('Failed to create settings category');
        }

        return created;
    }

    // Load service category setting from key-value store
    async function loadServiceCategorySetting(categoryId: number): Promise<void> {
        const values = await getCustomDataValues<DienstplanungSettings>(categoryId, moduleId!);

        // Find serviceCategory value
        const serviceCatValue = values.find((v) => v.key === 'serviceCategory');

        if (serviceCatValue) {
            // Store the original value object for updates
            serviceCategoryValue = serviceCatValue as any;
            currentServiceCategoryId = serviceCatValue.value || '';
        }
    }

    // Save service category to key-value store
    async function saveServiceCategory(categoryId: string): Promise<void> {
        if (!moduleId || !settingsCategory) {
            throw new Error('Extension not initialized');
        }

        const valueData = JSON.stringify({
            key: 'serviceCategory',
            value: categoryId,
        });

        if (serviceCategoryValue) {
            // Update existing value
            await updateCustomDataValue(
                settingsCategory.id,
                serviceCategoryValue.id,
                { value: valueData },
                moduleId
            );
            serviceCategoryValue.value = valueData;
        } else {
            // Create new value
            await createCustomDataValue(
                {
                    dataCategoryId: settingsCategory.id,
                    value: valueData,
                },
                moduleId
            );

            // Reload to get the created value
            await loadServiceCategorySetting(settingsCategory.id);
        }

        currentServiceCategoryId = categoryId;
        render();
    }

    // Render UI
    function renderScenariosView(): string {
        const filteredScenarios = scenarios.filter(s => 
            scenarioFilter === '' || 
            s.name.toLowerCase().includes(scenarioFilter.toLowerCase()) ||
            s.description.toLowerCase().includes(scenarioFilter.toLowerCase()) ||
            s.shortName.toLowerCase().includes(scenarioFilter.toLowerCase())
        );
        
        return `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
                <div>
                    <h2 style="margin: 0 0 0.25rem 0; font-size: 1.1rem;">Planungsszenarien</h2>
                    <p style="margin: 0; color: #666; font-size: 0.9rem;">
                        Verwalten Sie verschiedene Planungsszenarien mit eigenen Filtern und Berechtigungen.
                    </p>
                </div>
                <button 
                    id="new-scenario-btn"
                    style="padding: 0.75rem 1.5rem; background: #28a745; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 500; font-size: 1rem;"
                >
                    + Neues Szenario
                </button>
            </div>
            
            ${scenarios.length > 0 ? `
                <!-- Filter -->
                <div style="margin-bottom: 1rem;">
                    <input 
                        type="text" 
                        id="scenario-filter" 
                        placeholder="Szenarien filtern..."
                        value="${scenarioFilter}"
                        style="width: 100%; padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px; font-size: 1rem;"
                    />
                </div>
                
                <!-- Scenarios Table -->
                <div style="overflow-x: auto;">
                    <table style="width: 100%; border-collapse: collapse; background: white; border: 1px solid #ddd;">
                        <thead>
                            <tr style="background: #f8f9fa; border-bottom: 2px solid #dee2e6;">
                                <th style="padding: 0.75rem; text-align: left; font-weight: 600;">ID</th>
                                <th style="padding: 0.75rem; text-align: left; font-weight: 600;">Kurzname</th>
                                <th style="padding: 0.75rem; text-align: left; font-weight: 600;">Name</th>
                                <th style="padding: 0.75rem; text-align: left; font-weight: 600;">Beschreibung</th>
                                <th style="padding: 0.75rem; text-align: center; font-weight: 600;">Kalender</th>
                                <th style="padding: 0.75rem; text-align: center; font-weight: 600;">Kategorien</th>
                                <th style="padding: 0.75rem; text-align: center; font-weight: 600;">Gruppen</th>
                                <th style="padding: 0.75rem; text-align: center; font-weight: 600;">Aktionen</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${filteredScenarios.map((scenario) => {
                                // Render calendar chips
                                const calendarChips = scenario.calendarIds.length > 0
                                    ? scenario.calendarIds.map(id => {
                                        const cal = calendars.find(c => c.id === id);
                                        const name = cal?.name || `#${id}`;
                                        const color = cal?.color || '#007bff';
                                        return `<span style="display: inline-block; padding: 0.15rem 0.5rem; background: ${color}; color: white; border-radius: 12px; font-size: 0.75rem; margin: 0.1rem;">${name}</span>`;
                                    }).join('')
                                    : '<span style="color: #999;">-</span>';
                                
                                // Render category chips
                                const categoryChips = scenario.serviceCategoryIds.length > 0
                                    ? scenario.serviceCategoryIds.map(id => {
                                        const cat = serviceCategories.find(c => c.id === id);
                                        const name = cat?.name || cat?.bezeichnung || `#${id}`;
                                        return `<span style="display: inline-block; padding: 0.15rem 0.5rem; background: #28a745; color: white; border-radius: 12px; font-size: 0.75rem; margin: 0.1rem;">${name}</span>`;
                                    }).join('')
                                    : '<span style="color: #999;">-</span>';
                                
                                // Render group chips
                                const groupChips = scenario.serviceGroupIds.length > 0 
                                    ? scenario.serviceGroupIds.map(id => {
                                        return `<span style="display: inline-block; padding: 0.15rem 0.5rem; background: #6c757d; color: white; border-radius: 12px; font-size: 0.75rem; margin: 0.1rem;">#${id}</span>`;
                                    }).join('')
                                    : '<span style="color: #999;">-</span>';
                                
                                return `
                                <tr style="border-bottom: 1px solid #dee2e6;">
                                    <td style="padding: 0.75rem; font-family: monospace; font-size: 0.85rem; color: #999; vertical-align: top;">#${scenario.id || '?'}</td>
                                    <td style="padding: 0.75rem; font-family: monospace; font-size: 0.9rem; vertical-align: top;">${scenario.shortName}</td>
                                    <td style="padding: 0.75rem; font-weight: 500; vertical-align: top;">${scenario.name}</td>
                                    <td style="padding: 0.75rem; color: #666; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: top;" title="${scenario.description}">${scenario.description}</td>
                                    <td style="padding: 0.75rem; vertical-align: top;">${calendarChips}</td>
                                    <td style="padding: 0.75rem; vertical-align: top;">${categoryChips}</td>
                                    <td style="padding: 0.75rem; vertical-align: top;">${groupChips}</td>
                                    <td style="padding: 0.75rem; text-align: center; vertical-align: top;">
                                        <button 
                                            class="edit-scenario-btn" 
                                            data-index="${scenarios.indexOf(scenario)}"
                                            style="padding: 0.25rem 0.75rem; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; margin-right: 0.5rem;"
                                        >
                                            Bearbeiten
                                        </button>
                                        <button 
                                            class="delete-scenario-btn" 
                                            data-index="${scenarios.indexOf(scenario)}"
                                            style="padding: 0.25rem 0.75rem; background: #dc3545; color: white; border: none; border-radius: 4px; cursor: pointer;"
                                        >
                                            Löschen
                                        </button>
                                    </td>
                                </tr>`;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            ` : `
                <div style="padding: 3rem; text-align: center; background: #f9f9f9; border-radius: 8px; border: 2px dashed #ddd;">
                    <p style="margin: 0 0 1rem 0; color: #666; font-size: 1.1rem;">Noch keine Szenarien vorhanden</p>
                    <p style="margin: 0; color: #999; font-size: 0.9rem;">Klicken Sie auf "Neues Szenario" um zu beginnen</p>
                </div>
            `}
            
            ${showModal ? renderScenarioModal() : ''}
        `;
    }
    
    function renderScenarioModal(): string {
        const isEdit = editingScenario !== null;
        
        // Use modal state for rendering
        const selectedCalendars = modalSelectedCalendars;
        const selectedCategories = modalSelectedCategories;
        const selectedGroups = modalSelectedGroups;
        
        const scenario = editingScenario || {
            shortName: '',
            name: '',
            description: '',
            disponentPermissions: [] as number[],
            mitarbeiterPermissions: [] as number[]
        };
        
        return `
            <!-- Modal Overlay -->
            <div id="scenario-modal-overlay" style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 1000; display: flex; align-items: center; justify-content: center;">
                <div style="background: white; border-radius: 8px; max-width: 600px; width: 90%; max-height: 90vh; overflow-y: auto; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                    <div style="padding: 1.5rem; border-bottom: 1px solid #dee2e6; display: flex; justify-content: space-between; align-items: center;">
                        <h3 style="margin: 0; font-size: 1.2rem;">${isEdit ? 'Szenario bearbeiten' : 'Neues Szenario erstellen'}</h3>
                        <button id="close-modal-btn" style="background: none; border: none; font-size: 1.5rem; cursor: pointer; color: #666;">&times;</button>
                    </div>
                    
                    <div style="padding: 1.5rem;">
                        <div style="margin-bottom: 1rem;">
                            <label style="display: block; margin-bottom: 0.25rem; font-weight: 500;">Kurzname (eindeutig, z.B. "service"):</label>
                            <input 
                                type="text" 
                                id="scenario-shortname" 
                                value="${scenario.shortName}"
                                ${isEdit ? 'disabled' : ''}
                                placeholder="service"
                                style="width: 100%; padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px; ${isEdit ? 'background: #f5f5f5;' : ''}"
                            />
                            <small style="color: #666;">Wird als Referenz verwendet (z.B. in URLs)</small>
                        </div>
                        
                        <div style="margin-bottom: 1rem;">
                            <label style="display: block; margin-bottom: 0.25rem; font-weight: 500;">Name:</label>
                            <input 
                                type="text" 
                                id="scenario-name" 
                                value="${scenario.name}"
                                placeholder="Service"
                                style="width: 100%; padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px;"
                            />
                        </div>
                        
                        <div style="margin-bottom: 1rem;">
                            <label style="display: block; margin-bottom: 0.25rem; font-weight: 500;">Beschreibung:</label>
                            <textarea 
                                id="scenario-description" 
                                placeholder="Gottesdienst-Planung"
                                rows="3"
                                style="width: 100%; padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px; font-family: inherit; resize: vertical;"
                            >${scenario.description}</textarea>
                        </div>
                        
                        <div style="margin-bottom: 1rem;">
                            <label style="display: block; margin-bottom: 0.5rem; font-weight: 500;">Kalender:</label>
                            
                            <!-- Selected Calendars as Chips -->
                            <div id="calendar-chips" style="display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 0.5rem; min-height: 2rem;">
                                ${selectedCalendars.map(calId => {
                                    const cal = calendars.find(c => c.id === calId);
                                    return cal ? `
                                        <div class="chip" data-type="calendar" data-id="${calId}" style="display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.25rem 0.75rem; background: #007bff; color: white; border-radius: 16px; font-size: 0.9rem;">
                                            <span>${cal.name || cal.title}</span>
                                            <button type="button" class="remove-chip" data-type="calendar" data-id="${calId}" style="background: none; border: none; color: white; cursor: pointer; font-size: 1.2rem; line-height: 1; padding: 0;">&times;</button>
                                        </div>
                                    ` : '';
                                }).join('')}
                            </div>
                            
                            <!-- Add Calendar Custom Dropdown -->
                            <div style="position: relative;">
                                <button 
                                    type="button"
                                    id="calendar-dropdown-btn" 
                                    style="width: 100%; padding: 0.75rem; border: 1px solid #ddd; border-radius: 4px; background: white; text-align: left; cursor: pointer; display: flex; align-items: center; justify-content: space-between;"
                                >
                                    <span style="color: #666;">+ Kalender hinzufügen...</span>
                                    <span style="color: #999;">▼</span>
                                </button>
                                <div 
                                    id="calendar-dropdown-menu" 
                                    style="display: none; position: absolute; top: 100%; left: 0; right: 0; background: white; border: 1px solid #ddd; border-radius: 4px; margin-top: 0.25rem; max-height: 350px; overflow: hidden; z-index: 1000; box-shadow: 0 4px 6px rgba(0,0,0,0.1);"
                                >
                                    <div style="padding: 0.5rem; border-bottom: 1px solid #ddd; position: sticky; top: 0; background: white;">
                                        <input 
                                            type="text" 
                                            id="calendar-search" 
                                            placeholder="Kalender suchen..."
                                            style="width: 100%; padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px; font-size: 0.9rem;"
                                        />
                                    </div>
                                    <div id="calendar-options-list" style="max-height: 250px; overflow-y: auto;">
                                        ${calendars.filter(cal => !selectedCalendars.includes(cal.id)).map(cal => `
                                        <div 
                                            class="calendar-option" 
                                            data-id="${cal.id}"
                                            style="padding: 0.75rem; cursor: pointer; border-bottom: 1px solid #f0f0f0; display: flex; align-items: center; gap: 0.75rem;"
                                            onmouseover="this.style.background='#f8f9fa'" 
                                            onmouseout="this.style.background='white'"
                                        >
                                            <div style="width: 40px; height: 40px; border-radius: 4px; background: ${cal.color || '#007bff'}; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; flex-shrink: 0;">
                                                ${(cal.name || cal.title || '?').substring(0, 2).toUpperCase()}
                                            </div>
                                            <div style="flex: 1;">
                                                <div style="font-weight: 500; margin-bottom: 0.25rem;">${cal.name || cal.title}</div>
                                                <div style="font-size: 0.85rem; color: #666;">ID: ${cal.id}</div>
                                            </div>
                                        </div>
                                    `).join('')}
                                        ${calendars.filter(cal => !selectedCalendars.includes(cal.id)).length === 0 ? `
                                            <div style="padding: 1rem; text-align: center; color: #999;">
                                                Alle Kalender ausgewählt
                                            </div>
                                        ` : ''}
                                    </div>
                                </div>
                            </div>
                        </div>
                        
                        <div style="margin-bottom: 1rem;">
                            <label style="display: block; margin-bottom: 0.5rem; font-weight: 500;">Dienstkategorien:</label>
                            
                            <!-- Selected Categories as Chips -->
                            <div id="category-chips" style="display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 0.5rem; min-height: 2rem;">
                                ${selectedCategories.map(catId => {
                                    const cat = serviceCategories.find(c => c.id === catId);
                                    return cat ? `
                                        <div class="chip" data-type="category" data-id="${catId}" style="display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.25rem 0.75rem; background: #28a745; color: white; border-radius: 16px; font-size: 0.9rem;">
                                            <span>${cat.name || cat.bezeichnung}</span>
                                            <button type="button" class="remove-chip" data-type="category" data-id="${catId}" style="background: none; border: none; color: white; cursor: pointer; font-size: 1.2rem; line-height: 1; padding: 0;">&times;</button>
                                        </div>
                                    ` : '';
                                }).join('')}
                            </div>
                            
                            <!-- Add Category Custom Dropdown -->
                            <div style="position: relative;">
                                <button 
                                    type="button"
                                    id="category-dropdown-btn" 
                                    style="width: 100%; padding: 0.75rem; border: 1px solid #ddd; border-radius: 4px; background: white; text-align: left; cursor: pointer; display: flex; align-items: center; justify-content: space-between;"
                                >
                                    <span style="color: #666;">+ Dienstkategorie hinzufügen...</span>
                                    <span style="color: #999;">▼</span>
                                </button>
                                <div 
                                    id="category-dropdown-menu" 
                                    style="display: none; position: absolute; top: 100%; left: 0; right: 0; background: white; border: 1px solid #ddd; border-radius: 4px; margin-top: 0.25rem; max-height: 350px; overflow: hidden; z-index: 1000; box-shadow: 0 4px 6px rgba(0,0,0,0.1);"
                                >
                                    <div style="padding: 0.5rem; border-bottom: 1px solid #ddd; position: sticky; top: 0; background: white;">
                                        <input 
                                            type="text" 
                                            id="category-search" 
                                            placeholder="Kategorie suchen..."
                                            style="width: 100%; padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px; font-size: 0.9rem;"
                                        />
                                    </div>
                                    <div id="category-options-list" style="max-height: 250px; overflow-y: auto;">
                                        ${serviceCategories.filter(cat => !selectedCategories.includes(cat.id)).map(cat => `
                                        <div 
                                            class="category-option" 
                                            data-id="${cat.id}"
                                            style="padding: 0.75rem; cursor: pointer; border-bottom: 1px solid #f0f0f0; display: flex; align-items: center; gap: 0.75rem;"
                                            onmouseover="this.style.background='#f8f9fa'" 
                                            onmouseout="this.style.background='white'"
                                        >
                                            <div style="width: 40px; height: 40px; border-radius: 4px; background: #28a745; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; flex-shrink: 0;">
                                                ${(cat.name || cat.bezeichnung || '?').substring(0, 2).toUpperCase()}
                                            </div>
                                            <div style="flex: 1;">
                                                <div style="font-weight: 500; margin-bottom: 0.25rem;">${cat.name || cat.bezeichnung}</div>
                                                <div style="font-size: 0.85rem; color: #666;">ID: ${cat.id}</div>
                                            </div>
                                        </div>
                                    `).join('')}
                                        ${serviceCategories.filter(cat => !selectedCategories.includes(cat.id)).length === 0 ? `
                                            <div style="padding: 1rem; text-align: center; color: #999;">
                                                Alle Kategorien ausgewählt
                                            </div>
                                        ` : ''}
                                    </div>
                                </div>
                            </div>
                        </div>
                        
                        <div style="margin-bottom: 1rem;">
                            <label style="display: block; margin-bottom: 0.5rem; font-weight: 500;">Besetzergruppen (optional):</label>
                            
                            <!-- Selected Groups as Chips -->
                            <div id="group-chips" style="display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 0.5rem; min-height: 2rem;">
                                ${selectedGroups.map(groupId => {
                                    const group = serviceGroups.find(g => g.id === groupId);
                                    return `
                                        <div class="chip" data-type="group" data-id="${groupId}" style="display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.25rem 0.75rem; background: #6c757d; color: white; border-radius: 16px; font-size: 0.9rem;">
                                            <span>${group ? group.name : `Gruppe ${groupId}`}</span>
                                            <button type="button" class="remove-chip" data-type="group" data-id="${groupId}" style="background: none; border: none; color: white; cursor: pointer; font-size: 1.2rem; line-height: 1; padding: 0;">&times;</button>
                                        </div>
                                    `;
                                }).join('')}
                            </div>
                            
                            <!-- Add Group Custom Dropdown -->
                            <div style="position: relative;">
                                <button 
                                    type="button"
                                    id="group-dropdown-btn" 
                                    style="width: 100%; padding: 0.75rem; border: 1px solid #ddd; border-radius: 4px; background: ${selectedCategories.length === 0 ? '#f5f5f5' : 'white'}; text-align: left; cursor: ${selectedCategories.length === 0 ? 'not-allowed' : 'pointer'}; display: flex; align-items: center; justify-content: space-between;"
                                    ${selectedCategories.length === 0 ? 'disabled' : ''}
                                >
                                    <span style="color: #666;">+ Besetzergruppe hinzufügen...</span>
                                    <span style="color: #999;">▼</span>
                                </button>
                                <div 
                                    id="group-dropdown-menu" 
                                    style="display: none; position: absolute; top: 100%; left: 0; right: 0; background: white; border: 1px solid #ddd; border-radius: 4px; margin-top: 0.25rem; max-height: 350px; overflow: hidden; z-index: 1000; box-shadow: 0 4px 6px rgba(0,0,0,0.1);"
                                >
                                    <div style="padding: 0.5rem; border-bottom: 1px solid #ddd; position: sticky; top: 0; background: white;">
                                        <input 
                                            type="text" 
                                            id="group-search" 
                                            placeholder="Gruppe suchen..."
                                            style="width: 100%; padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px; font-size: 0.9rem;"
                                        />
                                    </div>
                                    <div id="group-options-list" style="max-height: 250px; overflow-y: auto;">
                                        ${serviceGroups.filter(group => !selectedGroups.includes(group.id)).map(group => `
                                        <div 
                                            class="group-option" 
                                            data-id="${group.id}"
                                            style="padding: 0.75rem; cursor: pointer; border-bottom: 1px solid #f0f0f0; display: flex; align-items: center; gap: 0.75rem;"
                                            onmouseover="this.style.background='#f8f9fa'" 
                                            onmouseout="this.style.background='white'"
                                        >
                                            <div style="width: 40px; height: 40px; border-radius: 4px; background: #6c757d; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; flex-shrink: 0;">
                                                ${group.id}
                                            </div>
                                            <div style="flex: 1;">
                                                <div style="font-weight: 500; margin-bottom: 0.25rem;">${group.name}</div>
                                                <div style="font-size: 0.85rem; color: #666;">Gruppe ID: ${group.id}</div>
                                            </div>
                                        </div>
                                    `).join('')}
                                        ${serviceGroups.filter(group => !selectedGroups.includes(group.id)).length === 0 && serviceGroups.length > 0 ? `
                                            <div style="padding: 1rem; text-align: center; color: #999;">
                                                Alle Gruppen ausgewählt
                                            </div>
                                        ` : ''}
                                        ${serviceGroups.length === 0 && selectedCategories.length > 0 ? `
                                            <div style="padding: 1rem; text-align: center; color: #999;">
                                                Keine Gruppen gefunden
                                            </div>
                                        ` : ''}
                                    </div>
                                </div>
                            </div>
                            <small style="color: #666;">Wählen Sie zuerst Dienstkategorien aus. Leer lassen für alle Gruppen.</small>
                        </div>
                        

                        
                        <div id="scenario-message" style="margin-bottom: 1rem; padding: 0.75rem; border-radius: 4px; display: none;"></div>
                        
                        <div style="display: flex; gap: 0.5rem;">
                            <button 
                                id="save-scenario-btn"
                                style="flex: 1; padding: 0.75rem; background: #28a745; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 500;"
                            >
                                ${isEdit ? 'Änderungen speichern' : 'Szenario erstellen'}
                            </button>
                            <button 
                                id="cancel-modal-btn"
                                style="padding: 0.75rem 1.5rem; background: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 500;"
                            >
                                Abbrechen
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    function render() {
        element.innerHTML = `
            <div style="padding: 2rem; max-width: ${currentView === 'scenarios' ? '100%' : '800px'}; margin: 0 auto;">
                <!-- Extension Info Header -->
                <div style="background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 1.5rem; margin-bottom: 1.5rem;">
                    <h1 style="margin: 0 0 0.5rem 0; font-size: 1.5rem;">${data.extensionInfo?.name || 'Extension Settings'}</h1>
                    <p style="margin: 0 0 0.5rem 0; color: #666;">
                        ${data.extensionInfo?.description || 'Configure your extension settings'}
                    </p>
                    <div style="display: flex; gap: 1rem; margin-top: 1rem; font-size: 0.85rem; color: #999;">
                        <span><strong>Version:</strong> ${data.extensionInfo?.version || 'N/A'}</span>
                        <span><strong>Key:</strong> ${data.extensionInfo?.key || KEY || 'N/A'}</span>
                        ${data.extensionInfo?.author?.name ? `<span><strong>Author:</strong> ${data.extensionInfo.author.name}</span>` : ''}
                    </div>
                </div>
                
                <!-- Tab Navigation -->
                <div style="background: #fff; border: 1px solid #ddd; border-radius: 8px 8px 0 0; padding: 0; margin-bottom: 0; border-bottom: none;">
                    <div style="display: flex; gap: 0;">
                        <button 
                            id="tab-scenarios" 
                            style="flex: 1; padding: 1rem; border: none; background: ${currentView === 'scenarios' ? '#fff' : '#f5f5f5'}; cursor: pointer; font-weight: ${currentView === 'scenarios' ? 'bold' : 'normal'}; border-bottom: ${currentView === 'scenarios' ? '2px solid #007bff' : '2px solid transparent'};"
                        >
                            Planungsszenarien
                        </button>
                        <button 
                            id="tab-legacy" 
                            style="flex: 1; padding: 1rem; border: none; background: ${currentView === 'legacy' ? '#fff' : '#f5f5f5'}; cursor: pointer; font-weight: ${currentView === 'legacy' ? 'bold' : 'normal'}; border-bottom: ${currentView === 'legacy' ? '2px solid #007bff' : '2px solid transparent'};"
                        >
                            Legacy Einstellungen
                        </button>
                    </div>
                </div>

                <div style="background: #fff; border: 1px solid #ddd; border-radius: 0 0 8px 8px; padding: 1.5rem; border-top: none;">
                ${
                    isLoading
                        ? `
                    <div style="padding: 2rem; text-align: center; color: #666;">
                        <p>Loading settings...</p>
                    </div>
                `
                        : errorMessage
                          ? `
                    <div style="padding: 1rem; background: #fee; border: 1px solid #fcc; border-radius: 4px; color: #c00;">
                        <strong>Error:</strong> ${errorMessage}
                    </div>
                `
                          : currentView === 'scenarios'
                            ? renderScenariosView()
                            : `
                    <!-- Settings Form -->
                    <div style="background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 1.5rem;">
                        <h2 style="margin: 0 0 1rem 0; font-size: 1.1rem;">Dienstkategorie</h2>
                        <p style="margin: 0 0 1rem 0; color: #666; font-size: 0.9rem;">
                            Wählen Sie die Dienstkategorie aus, deren Dienste in der Dienstplanung angezeigt werden sollen.
                        </p>

                        <div style="margin-bottom: 1.5rem;">
                            <label for="service-category-select" style="display: block; margin-bottom: 0.5rem; font-weight: 500;">
                                Dienstkategorie:
                            </label>
                            <select
                                id="service-category-select"
                                style="width: 100%; padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px; font-size: 1rem;"
                            >
                                <option value="">-- Bitte wählen --</option>
                                ${serviceCategories.map(cat => `
                                    <option value="${cat.id}" ${cat.id.toString() === currentServiceCategoryId ? 'selected' : ''}>
                                        ${cat.name || cat.bezeichnung || `Kategorie ${cat.id}`}
                                    </option>
                                `).join('')}
                            </select>
                        </div>

                        ${currentServiceCategoryId ? `
                            <div style="padding: 1rem; background: #e7f3ff; border: 1px solid #b3d9ff; border-radius: 4px; margin-bottom: 1.5rem;">
                                <strong>Aktuell ausgewählt:</strong> 
                                ${serviceCategories.find(c => c.id.toString() === currentServiceCategoryId)?.name || 
                                  serviceCategories.find(c => c.id.toString() === currentServiceCategoryId)?.bezeichnung || 
                                  'Kategorie ' + currentServiceCategoryId}
                            </div>
                        ` : ''}

                        <button
                            id="save-btn"
                            style="width: 100%; padding: 0.75rem; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 1rem; font-weight: 500;"
                        >
                            Einstellungen speichern
                        </button>

                        <div id="status-message" style="margin-top: 1rem; padding: 0.75rem; border-radius: 4px; display: none;"></div>
                    </div>

                    <!-- Info Box -->
                    <div style="margin-top: 1.5rem; padding: 1rem; background: #f8f9fa; border-left: 4px solid #007bff; border-radius: 4px;">
                        <p style="margin: 0 0 0.5rem 0; font-size: 0.9rem; color: #666;">
                            <strong>Hinweis:</strong> Die Einstellungen werden im ChurchTools Key-Value Store gespeichert.
                            ${import.meta.env.MODE === 'development' ? 'Entwicklungsmodus aktiv.' : ''}
                        </p>
                    </div>

                    <!-- Berechtigungen Info -->
                    <div style="margin-top: 1.5rem; padding: 1rem; background: #fff3cd; border-left: 4px solid #ffc107; border-radius: 4px;">
                        <h3 style="margin: 0 0 0.5rem 0; font-size: 1rem; color: #856404;">Berechtigungen</h3>
                        <p style="margin: 0 0 0.5rem 0; font-size: 0.9rem; color: #856404;">
                            <strong>Mitarbeiter:</strong> Können ihre Verfügbarkeit in der "Dienstplanung" Ansicht melden.
                        </p>
                        <p style="margin: 0; font-size: 0.9rem; color: #856404;">
                            <strong>Disponenten:</strong> Haben zusätzlich Zugriff auf die "Dienstplanung Disponent" Ansicht zur Zuweisung von Mitarbeitern.
                            Berechtigungen werden über ChurchTools-Gruppen und Rollen gesteuert.
                        </p>
                    </div>
                `
                }
                </div>
            </div>
        `;

        if (!isLoading && !errorMessage) {
            attachEventHandlers();
        }
    }

    async function saveScenario() {
        console.log('[Admin] saveScenario called');
        
        const shortNameInput = element.querySelector('#scenario-shortname') as HTMLInputElement;
        const nameInput = element.querySelector('#scenario-name') as HTMLInputElement;
        const descInput = element.querySelector('#scenario-description') as HTMLInputElement;
        
        console.log('[Admin] Input elements:', { shortNameInput, nameInput, descInput });
        
        const shortName = shortNameInput?.value.trim() || '';
        const scenarioName = nameInput?.value.trim() || '';
        const scenarioDescription = descInput?.value.trim() || '';
        
        console.log('[Admin] Form values:', { shortName, scenarioName, scenarioDescription });
        
        // Get IDs from chips
        const calendarIds = modalSelectedCalendars;
        const serviceCategoryIds = modalSelectedCategories;
        const serviceGroupIds = modalSelectedGroups;
        
        // Permissions are managed via ChurchTools groups/roles, not stored in scenario
        const disponentPermissions: number[] = [];
        const mitarbeiterPermissions: number[] = [];
        
        const messageDiv = element.querySelector('#scenario-message') as HTMLDivElement;
        
        const isEdit = editingScenario !== null;
        
        // Validation
        if (!shortName || !scenarioName) {
            messageDiv.style.display = 'block';
            messageDiv.style.background = '#fee';
            messageDiv.style.border = '1px solid #fcc';
            messageDiv.style.color = '#c00';
            messageDiv.textContent = 'Kurzname und Name sind Pflichtfelder!';
            return;
        }
        
        if (!isEdit && scenarios.some(s => s.shortName === shortName)) {
            messageDiv.style.display = 'block';
            messageDiv.style.background = '#fee';
            messageDiv.style.border = '1px solid #fcc';
            messageDiv.style.color = '#c00';
            messageDiv.textContent = 'Ein Szenario mit diesem Kurznamen existiert bereits!';
            return;
        }
        
        try {
            if (!moduleId) throw new Error('Module ID not found');
            
            // Get or create scenarios category
            let scenariosCategory = await getCustomDataCategory<object>('scenarios');
            if (!scenariosCategory) {
                scenariosCategory = await createCustomDataCategory({
                    customModuleId: moduleId,
                    name: 'Planning Scenarios',
                    shorty: 'scenarios',
                    description: 'Configuration for planning scenarios',
                }, moduleId);
            }
            
            // Create scenario config
            const scenarioConfig: ScenarioConfig = {
                shortName,
                name: scenarioName,
                description: scenarioDescription,
                calendarIds,
                serviceCategoryIds,
                serviceGroupIds,
                disponentPermissions,
                mitarbeiterPermissions,
                createdAt: new Date().toISOString(),
                createdBy: 1 // TODO: Get from user context
            };
            
            if (isEdit && editingScenario) {
                // Update existing scenario using the technical ID
                const technicalId = editingScenario.id;
                
                if (!technicalId) {
                    throw new Error('Technical ID not found for editing scenario');
                }
                
                console.log('[Admin] Updating scenario:', { shortName, technicalId });
                
                // Update via API using PUT
                await churchtoolsClient.put(
                    `/custommodules/${moduleId}/customdatacategories/${scenariosCategory.id}/customdatavalues/${technicalId}`,
                    { value: JSON.stringify(scenarioConfig) }
                );
            } else {
                // Create new scenario
                await createCustomDataValue({
                    dataCategoryId: scenariosCategory.id,
                    value: JSON.stringify(scenarioConfig),
                }, moduleId);
                
                // Create data categories for scenario
                await createCustomDataCategory({
                    customModuleId: moduleId,
                    name: `${shortName} - Disponent Data`,
                    shorty: `${shortName}__disponent`,
                    description: `Disponent planning data for ${shortName}`,
                }, moduleId);
                
                await createCustomDataCategory({
                    customModuleId: moduleId,
                    name: `${shortName} - Mitarbeiter Data`,
                    shorty: `${shortName}__mitarbeiter`,
                    description: `Mitarbeiter data for ${shortName}`,
                }, moduleId);
            }
            
            messageDiv.style.display = 'block';
            messageDiv.style.background = '#d4edda';
            messageDiv.style.border = '1px solid #c3e6cb';
            messageDiv.style.color = '#155724';
            messageDiv.textContent = isEdit ? 'Szenario erfolgreich aktualisiert!' : 'Szenario erfolgreich erstellt!';
            
            // Reload scenarios and close modal
            await loadScenarios();
            setTimeout(() => {
                showModal = false;
                editingScenario = null;
                render();
            }, 1500);
            
        } catch (error) {
            console.error('[Admin] Failed to create scenario:', error);
            messageDiv.style.display = 'block';
            messageDiv.style.background = '#fee';
            messageDiv.style.border = '1px solid #fcc';
            messageDiv.style.color = '#c00';
            messageDiv.textContent = 'Fehler beim Erstellen: ' + (error instanceof Error ? error.message : 'Unbekannter Fehler');
        }
    }
    
    async function deleteScenario(index: number) {
        const scenario = scenarios[index];
        if (!confirm(`Szenario "${scenario.name}" wirklich löschen?`)) {
            return;
        }
        
        try {
            if (!moduleId) throw new Error('Module ID not found');
            
            const scenariosCategory = await getCustomDataCategory<object>('scenarios');
            if (!scenariosCategory) throw new Error('Scenarios category not found');
            
            // Use the technical ID from Custom Data Value
            const technicalId = scenario.id;
            
            console.log('[Admin] Deleting scenario:', { 
                shortName: scenario.shortName,
                scenarioName: scenario.name, 
                technicalId,
                categoryId: scenariosCategory.id 
            });
            
            if (!technicalId) {
                throw new Error('Technical ID not found in scenario object');
            }
            
            // Delete scenario value using correct API path
            await churchtoolsClient.deleteApi(
                `/custommodules/${moduleId}/customdatacategories/${scenariosCategory.id}/customdatavalues/${technicalId}`
            );
            
            console.log('[Admin] Scenario deleted successfully');
            
            // Reload and re-render
            await loadScenarios();
            render();
            
        } catch (error) {
            console.error('[Admin] Failed to delete scenario:', error);
            alert('Fehler beim Löschen: ' + (error instanceof Error ? error.message : 'Unbekannter Fehler'));
        }
    }

    // Attach event handlers
    function attachEventHandlers() {
        // Tab switcher
        const tabScenarios = element.querySelector('#tab-scenarios');
        const tabLegacy = element.querySelector('#tab-legacy');
        
        if (tabScenarios) {
            tabScenarios.addEventListener('click', () => {
                currentView = 'scenarios';
                render();
            });
        }
        
        if (tabLegacy) {
            tabLegacy.addEventListener('click', () => {
                currentView = 'legacy';
                render();
            });
        }
        
        // Scenario management
        const newScenarioBtn = element.querySelector('#new-scenario-btn');
        if (newScenarioBtn) {
            newScenarioBtn.addEventListener('click', () => {
                editingScenario = null;
                modalSelectedCalendars = [];
                modalSelectedCategories = [];
                modalSelectedGroups = [];
                showModal = true;
                render();
            });
        }
        
        const saveScenarioBtn = element.querySelector('#save-scenario-btn');
        if (saveScenarioBtn) {
            console.log('[Admin] Attaching save handler to button');
            saveScenarioBtn.addEventListener('click', (e) => {
                console.log('[Admin] Save button clicked');
                e.preventDefault();
                saveScenario();
            });
        } else {
            console.log('[Admin] Save button not found');
        }
        
        const closeModalBtn = element.querySelector('#close-modal-btn');
        const cancelModalBtn = element.querySelector('#cancel-modal-btn');
        const modalOverlay = element.querySelector('#scenario-modal-overlay');
        
        if (closeModalBtn) {
            closeModalBtn.addEventListener('click', () => {
                showModal = false;
                editingScenario = null;
                render();
            });
        }
        
        if (cancelModalBtn) {
            cancelModalBtn.addEventListener('click', () => {
                showModal = false;
                editingScenario = null;
                render();
            });
        }
        
        if (modalOverlay) {
            modalOverlay.addEventListener('click', (e) => {
                if (e.target === modalOverlay) {
                    showModal = false;
                    editingScenario = null;
                    render();
                }
            });
        }
        
        const scenarioFilterInput = element.querySelector('#scenario-filter');
        if (scenarioFilterInput) {
            scenarioFilterInput.addEventListener('input', (e) => {
                scenarioFilter = (e.target as HTMLInputElement).value;
                render();
            });
        }
        
        const editButtons = element.querySelectorAll('.edit-scenario-btn');
        editButtons.forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const index = Number((e.target as HTMLElement).dataset.index);
                editingScenario = scenarios[index];
                modalSelectedCalendars = [...editingScenario.calendarIds];
                modalSelectedCategories = [...editingScenario.serviceCategoryIds];
                modalSelectedGroups = [...editingScenario.serviceGroupIds];
                
                // Load service groups for selected categories
                if (modalSelectedCategories.length > 0) {
                    await loadServicesForCategories(modalSelectedCategories);
                }
                
                showModal = true;
                render();
            });
        });
        
        // Chip removal handlers
        const removeChipButtons = element.querySelectorAll('.remove-chip');
        removeChipButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const type = (e.target as HTMLElement).dataset.type;
                const id = Number((e.target as HTMLElement).dataset.id);
                
                if (type === 'calendar') {
                    modalSelectedCalendars = modalSelectedCalendars.filter(cid => cid !== id);
                } else if (type === 'category') {
                    modalSelectedCategories = modalSelectedCategories.filter(cid => cid !== id);
                    // Reload groups when categories change
                    if (modalSelectedCategories.length > 0) {
                        loadServicesForCategories(modalSelectedCategories).then(() => render());
                    } else {
                        serviceGroups = [];
                        render();
                    }
                    return;
                } else if (type === 'group') {
                    modalSelectedGroups = modalSelectedGroups.filter(gid => gid !== id);
                }
                
                render();
            });
        });
        
        // Custom dropdown toggles
        const calendarDropdownBtn = element.querySelector('#calendar-dropdown-btn');
        const calendarDropdownMenu = element.querySelector('#calendar-dropdown-menu');
        if (calendarDropdownBtn && calendarDropdownMenu) {
            calendarDropdownBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const isVisible = (calendarDropdownMenu as HTMLElement).style.display === 'block';
                (calendarDropdownMenu as HTMLElement).style.display = isVisible ? 'none' : 'block';
                // Close other dropdowns
                const categoryMenu = element.querySelector('#category-dropdown-menu') as HTMLElement;
                const groupMenu = element.querySelector('#group-dropdown-menu') as HTMLElement;
                if (categoryMenu) categoryMenu.style.display = 'none';
                if (groupMenu) groupMenu.style.display = 'none';
            });
        }
        
        const categoryDropdownBtn = element.querySelector('#category-dropdown-btn');
        const categoryDropdownMenu = element.querySelector('#category-dropdown-menu');
        if (categoryDropdownBtn && categoryDropdownMenu) {
            categoryDropdownBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const isVisible = (categoryDropdownMenu as HTMLElement).style.display === 'block';
                (categoryDropdownMenu as HTMLElement).style.display = isVisible ? 'none' : 'block';
                // Close other dropdowns
                const calendarMenu = element.querySelector('#calendar-dropdown-menu') as HTMLElement;
                const groupMenu = element.querySelector('#group-dropdown-menu') as HTMLElement;
                if (calendarMenu) calendarMenu.style.display = 'none';
                if (groupMenu) groupMenu.style.display = 'none';
            });
        }
        
        const groupDropdownBtn = element.querySelector('#group-dropdown-btn');
        const groupDropdownMenu = element.querySelector('#group-dropdown-menu');
        if (groupDropdownBtn && groupDropdownMenu) {
            groupDropdownBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (modalSelectedCategories.length === 0) return;
                const isVisible = (groupDropdownMenu as HTMLElement).style.display === 'block';
                (groupDropdownMenu as HTMLElement).style.display = isVisible ? 'none' : 'block';
                // Close other dropdowns
                const calendarMenu = element.querySelector('#calendar-dropdown-menu') as HTMLElement;
                const categoryMenu = element.querySelector('#category-dropdown-menu') as HTMLElement;
                if (calendarMenu) calendarMenu.style.display = 'none';
                if (categoryMenu) categoryMenu.style.display = 'none';
            });
        }
        
        // Close dropdowns when clicking outside
        document.addEventListener('click', () => {
            if (calendarDropdownMenu) (calendarDropdownMenu as HTMLElement).style.display = 'none';
            if (categoryDropdownMenu) (categoryDropdownMenu as HTMLElement).style.display = 'none';
            if (groupDropdownMenu) (groupDropdownMenu as HTMLElement).style.display = 'none';
        });
        
        // Calendar search
        const calendarSearch = element.querySelector('#calendar-search') as HTMLInputElement;
        if (calendarSearch) {
            calendarSearch.addEventListener('input', (e) => {
                const searchTerm = (e.target as HTMLInputElement).value.toLowerCase();
                const options = element.querySelectorAll('.calendar-option');
                options.forEach(option => {
                    const text = (option as HTMLElement).textContent?.toLowerCase() || '';
                    (option as HTMLElement).style.display = text.includes(searchTerm) ? 'flex' : 'none';
                });
            });
            calendarSearch.addEventListener('click', (e) => e.stopPropagation());
        }
        
        // Calendar options
        const calendarOptions = element.querySelectorAll('.calendar-option');
        calendarOptions.forEach(option => {
            option.addEventListener('click', () => {
                const id = Number((option as HTMLElement).dataset.id);
                if (!modalSelectedCalendars.includes(id)) {
                    modalSelectedCalendars.push(id);
                    render();
                }
            });
        });
        
        // Category search
        const categorySearch = element.querySelector('#category-search') as HTMLInputElement;
        if (categorySearch) {
            categorySearch.addEventListener('input', (e) => {
                const searchTerm = (e.target as HTMLInputElement).value.toLowerCase();
                const options = element.querySelectorAll('.category-option');
                options.forEach(option => {
                    const text = (option as HTMLElement).textContent?.toLowerCase() || '';
                    (option as HTMLElement).style.display = text.includes(searchTerm) ? 'flex' : 'none';
                });
            });
            categorySearch.addEventListener('click', (e) => e.stopPropagation());
        }
        
        // Category options
        const categoryOptions = element.querySelectorAll('.category-option');
        categoryOptions.forEach(option => {
            option.addEventListener('click', async () => {
                const id = Number((option as HTMLElement).dataset.id);
                if (!modalSelectedCategories.includes(id)) {
                    modalSelectedCategories.push(id);
                    // Reload groups when categories change
                    await loadServicesForCategories(modalSelectedCategories);
                    render();
                }
            });
        });
        
        // Group search
        const groupSearch = element.querySelector('#group-search') as HTMLInputElement;
        if (groupSearch) {
            groupSearch.addEventListener('input', (e) => {
                const searchTerm = (e.target as HTMLInputElement).value.toLowerCase();
                const options = element.querySelectorAll('.group-option');
                options.forEach(option => {
                    const text = (option as HTMLElement).textContent?.toLowerCase() || '';
                    (option as HTMLElement).style.display = text.includes(searchTerm) ? 'flex' : 'none';
                });
            });
            groupSearch.addEventListener('click', (e) => e.stopPropagation());
        }
        
        // Group options
        const groupOptions = element.querySelectorAll('.group-option');
        groupOptions.forEach(option => {
            option.addEventListener('click', () => {
                const id = Number((option as HTMLElement).dataset.id);
                if (!modalSelectedGroups.includes(id)) {
                    modalSelectedGroups.push(id);
                    render();
                }
            });
        });
        
        // Chip removal handlers
        const calendarChipRemoves = element.querySelectorAll('.calendar-chip-remove');
        calendarChipRemoves.forEach(btn => {
            btn.addEventListener('click', () => {
                const id = Number((btn as HTMLElement).dataset.id);
                modalSelectedCalendars = modalSelectedCalendars.filter(cid => cid !== id);
                render();
            });
        });
        
        const categoryChipRemoves = element.querySelectorAll('.category-chip-remove');
        categoryChipRemoves.forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = Number((btn as HTMLElement).dataset.id);
                modalSelectedCategories = modalSelectedCategories.filter(cid => cid !== id);
                // Reload groups when categories change
                await loadServicesForCategories(modalSelectedCategories);
                render();
            });
        });
        
        const groupChipRemoves = element.querySelectorAll('.group-chip-remove');
        groupChipRemoves.forEach(btn => {
            btn.addEventListener('click', () => {
                const id = Number((btn as HTMLElement).dataset.id);
                modalSelectedGroups = modalSelectedGroups.filter(gid => gid !== id);
                render();
            });
        });
        
        const deleteButtons = element.querySelectorAll('.delete-scenario-btn');
        deleteButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const index = Number((e.target as HTMLElement).dataset.index);
                deleteScenario(index);
            });
        });
        
        // Legacy settings
        const serviceCategorySelect = element.querySelector('#service-category-select') as HTMLSelectElement;
        const saveBtn = element.querySelector('#save-btn') as HTMLButtonElement;

        if (!serviceCategorySelect || !saveBtn) return;

        // Save button
        saveBtn.addEventListener('click', async () => {
            await handleSave(serviceCategorySelect.value);
        });
    }

    // Handle save
    async function handleSave(categoryId: string) {
        const saveBtn = element.querySelector('#save-btn') as HTMLButtonElement;
        const statusMessage = element.querySelector('#status-message') as HTMLElement;

        if (!saveBtn || !statusMessage) return;

        if (!categoryId) {
            statusMessage.style.display = 'block';
            statusMessage.style.background = '#fff3cd';
            statusMessage.style.border = '1px solid #ffeaa7';
            statusMessage.style.color = '#856404';
            statusMessage.textContent = '⚠️ Bitte wählen Sie eine Dienstkategorie aus.';
            return;
        }

        try {
            saveBtn.disabled = true;
            saveBtn.textContent = 'Speichern...';

            await saveServiceCategory(categoryId);

            // Show success message
            statusMessage.style.display = 'block';
            statusMessage.style.background = '#d4edda';
            statusMessage.style.border = '1px solid #c3e6cb';
            statusMessage.style.color = '#155724';
            statusMessage.textContent = '✓ Einstellungen erfolgreich gespeichert!';

            // Emit notification to ChurchTools
            emit('notification:show', {
                message: 'Einstellungen erfolgreich gespeichert!',
                type: 'success',
                duration: 3000,
            });

            setTimeout(() => {
                statusMessage.style.display = 'none';
            }, 3000);
        } catch (error) {
            console.error('[Admin] Save error:', error);

            // Show error message
            statusMessage.style.display = 'block';
            statusMessage.style.background = '#f8d7da';
            statusMessage.style.border = '1px solid #f5c6cb';
            statusMessage.style.color = '#721c24';
            statusMessage.textContent =
                '✗ Fehler beim Speichern: ' +
                (error instanceof Error ? error.message : 'Unbekannter Fehler');
        } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Einstellungen speichern';
        }
    }

    // Initialize on load
    initialize();

    // Cleanup function
    return () => {
        console.log('[Admin] Cleaning up');
    };
};

// Named export for simple mode
export { adminEntryPoint };

// Default export for advanced mode
export default adminEntryPoint;
