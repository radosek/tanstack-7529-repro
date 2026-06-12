import { RouterClient } from "@tanstack/react-router/ssr/client";
import { StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { createRouter } from "./router";

const router = createRouter();

hydrateRoot(
	document,
	<StrictMode>
		<RouterClient router={router} />
	</StrictMode>,
);
