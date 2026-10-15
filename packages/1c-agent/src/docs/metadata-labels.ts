// Русские подписи каталогов и модулей 1C:EDT для дерева и заголовков документации.

interface MetadataTypeLabel {
	readonly single: string;
	readonly plural: string;
}

const METADATA_TYPES: Record<string, MetadataTypeLabel> = {
	AccountingRegisters: { single: "РегистрБухгалтерии", plural: "Регистры бухгалтерии" },
	AccumulationRegisters: { single: "РегистрНакопления", plural: "Регистры накопления" },
	BusinessProcesses: { single: "БизнесПроцесс", plural: "Бизнес-процессы" },
	CalculationRegisters: { single: "РегистрРасчета", plural: "Регистры расчета" },
	Catalogs: { single: "Справочник", plural: "Справочники" },
	ChartsOfAccounts: { single: "ПланСчетов", plural: "Планы счетов" },
	ChartsOfCalculationTypes: { single: "ПланВидовРасчета", plural: "Планы видов расчета" },
	ChartsOfCharacteristicTypes: { single: "ПланВидовХарактеристик", plural: "Планы видов характеристик" },
	CommonCommands: { single: "ОбщаяКоманда", plural: "Общие команды" },
	CommonForms: { single: "ОбщаяФорма", plural: "Общие формы" },
	CommonModules: { single: "ОбщийМодуль", plural: "Общие модули" },
	Configuration: { single: "Конфигурация", plural: "Конфигурация" },
	Constants: { single: "Константа", plural: "Константы" },
	DataProcessors: { single: "Обработка", plural: "Обработки" },
	DocumentJournals: { single: "ЖурналДокументов", plural: "Журналы документов" },
	Documents: { single: "Документ", plural: "Документы" },
	Enums: { single: "Перечисление", plural: "Перечисления" },
	ExchangePlans: { single: "ПланОбмена", plural: "Планы обмена" },
	FilterCriteria: { single: "КритерийОтбора", plural: "Критерии отбора" },
	HTTPServices: { single: "HTTPСервис", plural: "HTTP-сервисы" },
	InformationRegisters: { single: "РегистрСведений", plural: "Регистры сведений" },
	Reports: { single: "Отчет", plural: "Отчеты" },
	SettingsStorages: { single: "ХранилищеНастроек", plural: "Хранилища настроек" },
	Tasks: { single: "Задача", plural: "Задачи" },
	WebServices: { single: "WebСервис", plural: "Web-сервисы" },
};

const NESTED_FOLDERS: Record<string, MetadataTypeLabel> = {
	Commands: { single: "Команда", plural: "Команды" },
	Forms: { single: "Форма", plural: "Формы" },
};

const MODULE_FILES: Record<string, string> = {
	CommandModule: "Модуль команды",
	ExternalConnectionModule: "Модуль внешнего соединения",
	ManagedApplicationModule: "Модуль управляемого приложения",
	ManagerModule: "Модуль менеджера",
	Module: "Модуль",
	ObjectModule: "Модуль объекта",
	OrdinaryApplicationModule: "Модуль обычного приложения",
	RecordSetModule: "Модуль набора записей",
	SessionModule: "Модуль сеанса",
	ValueManagerModule: "Модуль менеджера значения",
};

const OWN_MODULE_FILES = new Set(["Module.bsl", "CommandModule.bsl"]);

function stripExtension(fileName: string): string {
	return fileName.replace(/\.bsl$/i, "");
}

export function isMetadataTypeFolder(segment: string): boolean {
	return segment in METADATA_TYPES;
}

export function folderLabel(segment: string): string {
	return METADATA_TYPES[segment]?.plural ?? NESTED_FOLDERS[segment]?.plural ?? segment;
}

export function moduleFileLabel(fileName: string): string {
	const base = stripExtension(fileName);
	return MODULE_FILES[base] ?? base;
}

export function isOwnModuleFile(fileName: string): boolean {
	return OWN_MODULE_FILES.has(fileName);
}

export function describeModule(relativePath: string): string {
	// Строит заголовок модуля вида «Документ.Заказ: Модуль объекта» по пути в проекте EDT.
	const segments = relativePath.split("/");
	const typeIndex = segments.findIndex((segment) => segment in METADATA_TYPES);
	const fileName = segments[segments.length - 1] ?? relativePath;
	if (typeIndex === -1) {
		return stripExtension(relativePath);
	}
	const objectPath = segments.slice(typeIndex, -1);
	const parts: string[] = [];
	for (let index = 0; index < objectPath.length; index++) {
		const segment = objectPath[index];
		const label = index === 0 ? METADATA_TYPES[segment]?.single : NESTED_FOLDERS[segment]?.single;
		parts.push(label ?? segment);
	}
	const title = parts.join(".");
	if (isOwnModuleFile(fileName) && objectPath.length > 1) {
		return title;
	}
	return `${title}: ${moduleFileLabel(fileName)}`;
}
