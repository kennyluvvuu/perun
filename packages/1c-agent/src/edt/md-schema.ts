// Схема параметров инструмента 1c_md: действие, объект, дочерние элементы и опции создания.

import { type Static, Type } from "typebox";

const FIELD = Type.Object({
	name: Type.String({ description: "Имя (идентификатор 1С)" }),
	type: Type.Optional(
		Type.String({
			description:
				"Тип: Строка(50), Строка(0) — неогр., Число(15,2), Число(15,3,неотр), Булево, Дата, ДатаВремя, СправочникСсылка.Товары, ПеречислениеСсылка.Статусы; составной через |",
		}),
	),
	synonym: Type.Optional(Type.String({ description: "Синоним; по умолчанию строится из имени" })),
	required: Type.Optional(Type.Boolean({ description: "Проверка заполнения (ShowError)" })),
	indexed: Type.Optional(Type.Boolean({ description: "Индексировать" })),
});

const FIELDS = Type.Optional(Type.Array(FIELD));

export const MD_SCHEMA = Type.Object({
	action: Type.Union([Type.Literal("info"), Type.Literal("create"), Type.Literal("add"), Type.Literal("validate")], {
		description:
			"info — состав объекта или обзор конфигурации; create — новый объект; add — добавить элементы в существующий; validate — проверить все .mdo проекта",
	}),
	object: Type.Optional(
		Type.String({
			description:
				"Объект: «Документ.ПеремещениеТоваров» или «Document.ПеремещениеТоваров». Для info можно только вид («Документ») или ничего — обзор конфигурации",
		}),
	),
	synonym: Type.Optional(Type.String({ description: "Синоним создаваемого объекта" })),
	attributes: FIELDS,
	tabularSections: Type.Optional(
		Type.Array(
			Type.Object({
				name: Type.String(),
				synonym: Type.Optional(Type.String()),
				attributes: FIELDS,
			}),
			{ description: "Новые табличные части с реквизитами" },
		),
	),
	tabularSection: Type.Optional(
		Type.String({ description: "Для add: имя существующей ТЧ, в которую добавить attributes" }),
	),
	dimensions: FIELDS,
	resources: FIELDS,
	values: Type.Optional(Type.Array(FIELD, { description: "Значения перечисления (тип не нужен)" })),
	registerRecords: Type.Optional(
		Type.Array(Type.String(), { description: "Регистры движений документа: «РегистрНакопления.Остатки»" }),
	),
	subsystem: Type.Optional(
		Type.String({ description: "Включить объект в подсистему (вложенная: «Родитель/Дочерняя»)" }),
	),
	options: Type.Optional(
		Type.Object({
			registerType: Type.Optional(Type.Union([Type.Literal("Balance"), Type.Literal("Turnovers")])),
			periodicity: Type.Optional(
				Type.Union([
					Type.Literal("Nonperiodical"),
					Type.Literal("Second"),
					Type.Literal("Day"),
					Type.Literal("Month"),
					Type.Literal("Quarter"),
					Type.Literal("Year"),
					Type.Literal("RecorderPosition"),
				]),
			),
			writeMode: Type.Optional(Type.Union([Type.Literal("Independent"), Type.Literal("RecorderSubordinate")])),
			context: Type.Optional(
				Type.Union(
					[
						Type.Literal("server"),
						Type.Literal("serverCall"),
						Type.Literal("client"),
						Type.Literal("clientServer"),
						Type.Literal("global"),
					],
					{ description: "Общий модуль: контекст исполнения (по умолчанию server)" },
				),
			),
			hierarchical: Type.Optional(Type.Boolean()),
			codeLength: Type.Optional(Type.Number()),
			descriptionLength: Type.Optional(Type.Number()),
			numberLength: Type.Optional(Type.Number()),
			type: Type.Optional(Type.String({ description: "Тип значения константы" })),
		}),
	),
});

export type MdParams = Static<typeof MD_SCHEMA>;
