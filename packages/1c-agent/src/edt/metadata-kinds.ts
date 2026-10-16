// Справочник видов метаданных EDT: каталог в src/, русское имя, коллекция в Configuration.mdo и ссылочный тип.

import type { KindInfo, MdoRef } from "./types.ts";

export const KINDS: readonly KindInfo[] = [
	{
		kind: "Catalog",
		folder: "Catalogs",
		ru: "Справочник",
		collection: "catalogs",
		refType: "CatalogRef",
		ruRefType: "СправочникСсылка",
	},
	{
		kind: "Document",
		folder: "Documents",
		ru: "Документ",
		collection: "documents",
		refType: "DocumentRef",
		ruRefType: "ДокументСсылка",
	},
	{
		kind: "Enum",
		folder: "Enums",
		ru: "Перечисление",
		collection: "enums",
		refType: "EnumRef",
		ruRefType: "ПеречислениеСсылка",
	},
	{ kind: "Constant", folder: "Constants", ru: "Константа", collection: "constants" },
	{ kind: "CommonModule", folder: "CommonModules", ru: "ОбщийМодуль", collection: "commonModules" },
	{
		kind: "InformationRegister",
		folder: "InformationRegisters",
		ru: "РегистрСведений",
		collection: "informationRegisters",
	},
	{
		kind: "AccumulationRegister",
		folder: "AccumulationRegisters",
		ru: "РегистрНакопления",
		collection: "accumulationRegisters",
	},
	{
		kind: "AccountingRegister",
		folder: "AccountingRegisters",
		ru: "РегистрБухгалтерии",
		collection: "accountingRegisters",
	},
	{ kind: "CalculationRegister", folder: "CalculationRegisters", ru: "РегистрРасчета" },
	{ kind: "DataProcessor", folder: "DataProcessors", ru: "Обработка", collection: "dataProcessors" },
	{ kind: "Report", folder: "Reports", ru: "Отчет", collection: "reports" },
	{ kind: "Subsystem", folder: "Subsystems", ru: "Подсистема", collection: "subsystems" },
	{
		kind: "ChartOfCharacteristicTypes",
		folder: "ChartsOfCharacteristicTypes",
		ru: "ПланВидовХарактеристик",
		collection: "chartsOfCharacteristicTypes",
		refType: "ChartOfCharacteristicTypesRef",
		ruRefType: "ПланВидовХарактеристикСсылка",
	},
	{
		kind: "ChartOfAccounts",
		folder: "ChartsOfAccounts",
		ru: "ПланСчетов",
		collection: "chartsOfAccounts",
		refType: "ChartOfAccountsRef",
		ruRefType: "ПланСчетовСсылка",
	},
	{
		kind: "ChartOfCalculationTypes",
		folder: "ChartsOfCalculationTypes",
		ru: "ПланВидовРасчета",
		collection: "chartsOfCalculationTypes",
		refType: "ChartOfCalculationTypesRef",
		ruRefType: "ПланВидовРасчетаСсылка",
	},
	{
		kind: "ExchangePlan",
		folder: "ExchangePlans",
		ru: "ПланОбмена",
		collection: "exchangePlans",
		refType: "ExchangePlanRef",
		ruRefType: "ПланОбменаСсылка",
	},
	{
		kind: "BusinessProcess",
		folder: "BusinessProcesses",
		ru: "БизнесПроцесс",
		refType: "BusinessProcessRef",
		ruRefType: "БизнесПроцессСсылка",
	},
	{ kind: "Task", folder: "Tasks", ru: "Задача", refType: "TaskRef", ruRefType: "ЗадачаСсылка" },
	{ kind: "DocumentJournal", folder: "DocumentJournals", ru: "ЖурналДокументов", collection: "documentJournals" },
	{ kind: "DocumentNumerator", folder: "DocumentNumerators", ru: "НумераторДокументов" },
	{ kind: "Sequence", folder: "Sequences", ru: "Последовательность" },
	{ kind: "CommonForm", folder: "CommonForms", ru: "ОбщаяФорма", collection: "commonForms" },
	{ kind: "CommonCommand", folder: "CommonCommands", ru: "ОбщаяКоманда", collection: "commonCommands" },
	{ kind: "CommandGroup", folder: "CommandGroups", ru: "ГруппаКоманд", collection: "commandGroups" },
	{ kind: "CommonTemplate", folder: "CommonTemplates", ru: "ОбщийМакет", collection: "commonTemplates" },
	{ kind: "CommonPicture", folder: "CommonPictures", ru: "ОбщаяКартинка", collection: "commonPictures" },
	{ kind: "CommonAttribute", folder: "CommonAttributes", ru: "ОбщийРеквизит", collection: "commonAttributes" },
	{ kind: "Role", folder: "Roles", ru: "Роль", collection: "roles" },
	{ kind: "SessionParameter", folder: "SessionParameters", ru: "ПараметрСеанса", collection: "sessionParameters" },
	{ kind: "DefinedType", folder: "DefinedTypes", ru: "ОпределяемыйТип" },
	{
		kind: "FunctionalOption",
		folder: "FunctionalOptions",
		ru: "ФункциональнаяОпция",
		collection: "functionalOptions",
	},
	{
		kind: "FunctionalOptionsParameter",
		folder: "FunctionalOptionsParameters",
		ru: "ПараметрФункциональныхОпций",
		collection: "functionalOptionsParameters",
	},
	{
		kind: "EventSubscription",
		folder: "EventSubscriptions",
		ru: "ПодпискаНаСобытие",
		collection: "eventSubscriptions",
	},
	{ kind: "ScheduledJob", folder: "ScheduledJobs", ru: "РегламентноеЗадание", collection: "scheduledJobs" },
	{ kind: "SettingsStorage", folder: "SettingsStorages", ru: "ХранилищеНастроек", collection: "settingsStorages" },
	{ kind: "FilterCriterion", folder: "FilterCriteria", ru: "КритерийОтбора", collection: "filterCriteria" },
	{ kind: "XDTOPackage", folder: "XDTOPackages", ru: "ПакетXDTO", collection: "xDTOPackages" },
	{ kind: "WebService", folder: "WebServices", ru: "WebСервис", collection: "webServices" },
	{ kind: "HTTPService", folder: "HTTPServices", ru: "HTTPСервис", collection: "httpServices" },
	{ kind: "WSReference", folder: "WSReferences", ru: "WSСсылка" },
	{ kind: "StyleItem", folder: "StyleItems", ru: "ЭлементСтиля", collection: "styleItems" },
	{ kind: "Style", folder: "Styles", ru: "Стиль" },
	{ kind: "ExternalDataSource", folder: "ExternalDataSources", ru: "ВнешнийИсточникДанных" },
];

const normalize = (value: string): string => value.trim().toLowerCase();

export function findKind(input: string): KindInfo | undefined {
	// Находит вид метаданных по английскому или русскому имени либо по имени каталога в src/.
	const key = normalize(input);
	return KINDS.find(
		(info) => normalize(info.kind) === key || normalize(info.ru) === key || normalize(info.folder) === key,
	);
}

export function parseObjectRef(input: string): MdoRef | undefined {
	const match = input.trim().match(/^([^./\\\s]+)[./\\]([^./\\\s]+)$/u);
	const kind = match ? findKind(match[1]) : undefined;
	return match && kind ? { kind, name: match[2] } : undefined;
}

export function findKindByRefType(prefix: string): KindInfo | undefined {
	const key = normalize(prefix);
	return KINDS.find(
		(info) =>
			(info.refType !== undefined && normalize(info.refType) === key) ||
			(info.ruRefType !== undefined && normalize(info.ruRefType) === key),
	);
}
