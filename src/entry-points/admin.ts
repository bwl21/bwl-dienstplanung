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
    let services: any[] = [];
    let currentView: 'legacy' | 'scenarios' = 'scenarios';

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
            const response = await churchtoolsClient.get('/calendars');
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
            console.log('[Admin] Scenarios loaded:', scenarios.length);
        } catch (error) {
            console.error('[Admin] Failed to load scenarios:', error);
            scenarios = [];
        }
    }

    // Load service categories from ChurchTools API
    async function loadServiceCategories() {
        try {
            console.log('[Admin] Loading service categories...');
            const response = await churchtoolsClient.get('/event/masterdata');
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
        return `
            <h2 style="margin: 0 0 1rem 0; font-size: 1.1rem;">Planungsszenarien</h2>
            <p style="margin: 0 0 1rem 0; color: #666; font-size: 0.9rem;">
                Verwalten Sie verschiedene Planungsszenarien mit eigenen Filtern und Berechtigungen.
            </p>
            
            ${scenarios.length === 0 ? `
                <div style="padding: 2rem; text-align: center; background: #f9f9f9; border-radius: 4px; margin-bottom: 1rem;">
                    <p style="color: #666;">Noch keine Szenarien konfiguriert.</p>
                    <p style="font-size: 0.9rem; color: #999;">Siehe <a href="https://github.com/bwl21/bwl-dienstplanung/blob/main/docs/scenario-setup-example.md" target="_blank">Dokumentation</a> für Setup-Anleitung.</p>
                </div>
            ` : `
                <div style="margin-bottom: 1rem;">
                    ${scenarios.map(scenario => `
                        <div style="border: 1px solid #ddd; border-radius: 4px; padding: 1rem; margin-bottom: 1rem;">
                            <h3 style="margin: 0 0 0.5rem 0; font-size: 1rem;">${scenario.name}</h3>
                            <p style="margin: 0 0 0.5rem 0; color: #666; font-size: 0.9rem;">${scenario.description}</p>
                            
                            <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.5rem; font-size: 0.85rem; color: #666;">
                                <div>
                                    <strong>Kalender:</strong> ${scenario.calendarIds.length > 0 ? scenario.calendarIds.join(', ') : 'Alle'}
                                </div>
                                <div>
                                    <strong>Kategorien:</strong> ${scenario.serviceCategoryIds.length > 0 ? scenario.serviceCategoryIds.join(', ') : 'Alle'}
                                </div>
                                <div>
                                    <strong>Gruppen:</strong> ${scenario.serviceGroupIds.length > 0 ? scenario.serviceGroupIds.join(', ') : 'Alle'}
                                </div>
                                <div>
                                    <strong>Disponenten:</strong> ${scenario.disponentPermissions.length} User
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `}
            
            <div style="padding: 1rem; background: #f0f8ff; border: 1px solid #b3d9ff; border-radius: 4px;">
                <strong>Hinweis:</strong> Szenarien können aktuell nur über die Browser-Console erstellt werden.
                Siehe <a href="https://github.com/bwl21/bwl-dienstplanung/blob/main/docs/scenario-setup-example.md" target="_blank" style="color: #007bff;">Dokumentation</a> für Details.
            </div>
        `;
    }

    function render() {
        element.innerHTML = `
            <div style="max-width: 800px; margin: 2rem auto; padding: 2rem;">
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
