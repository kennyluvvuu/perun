// Заготовки модулей BSL для новых объектов по стандарту структуры модуля: области и защита от вызова на клиенте.

const BOM = String.fromCharCode(0xfeff);
const SERVER_GUARD = "#Если Сервер Или ТолстыйКлиентОбычноеПриложение Или ВнешнееСоединение Тогда";
const CLIENT_CALL_ERROR = [
	"#Иначе",
	"ВызватьИсключение НСтр(\"ru = 'Недопустимый вызов объекта на клиенте.'\");",
	"#КонецЕсли",
];

function region(name: string, body: readonly string[] = []): string[] {
	return [`#Область ${name}`, "", ...body, ...(body.length > 0 ? [""] : []), "#КонецОбласти", ""];
}

function postingHandler(registerRecords: readonly string[]): string[] {
	if (registerRecords.length === 0) {
		return [];
	}
	return [
		"Процедура ОбработкаПроведения(Отказ, РежимПроведения)",
		"\t",
		...registerRecords.map((reference) => `\tДвижения.${reference.split(".")[1] ?? reference}.Записывать = Истина;`),
		"\t",
		"КонецПроцедуры",
	];
}

export function moduleTemplate(moduleFile: string, registerRecords: readonly string[] = []): string {
	// Возвращает текст заготовки модуля (с BOM, как сохраняет EDT) по имени файла модуля.
	let lines: string[];
	if (moduleFile === "Module.bsl") {
		lines = [
			...region("ПрограммныйИнтерфейс"),
			...region("СлужебныйПрограммныйИнтерфейс"),
			...region("СлужебныеПроцедурыИФункции"),
		];
	} else if (moduleFile === "RecordSetModule.bsl") {
		lines = [
			SERVER_GUARD,
			"",
			...region("ОбработчикиСобытий"),
			...region("СлужебныеПроцедурыИФункции"),
			...CLIENT_CALL_ERROR,
		];
	} else {
		lines = [
			SERVER_GUARD,
			"",
			...region("ПрограммныйИнтерфейс"),
			...region("ОбработчикиСобытий", postingHandler(registerRecords)),
			...region("СлужебныеПроцедурыИФункции"),
			...CLIENT_CALL_ERROR,
		];
	}
	return `${BOM}${lines.join("\n")}\n`;
}
