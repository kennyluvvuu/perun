// Раздел onec_environment системного промпта с кэшем: факты проекта собираются один раз и сбрасываются при новой сессии.

import { docsPromptSection } from "../docs/docs-prompt.ts";
import { buildOnecPrompt } from "./onec-prompt.ts";
import { collectProjectFacts } from "./project-facts.ts";

export class OnecPromptSection {
	private cached: { readonly cwd: string; readonly text: string } | undefined;

	public get(cwd: string): string {
		// Возвращает текст раздела для рабочего каталога, собирая факты проекта только при первом обращении.
		if (this.cached?.cwd !== cwd) {
			this.cached = { cwd, text: `${buildOnecPrompt(collectProjectFacts(cwd))}\n\n${docsPromptSection()}` };
		}
		return this.cached.text;
	}

	public invalidate(): void {
		this.cached = undefined;
	}
}
