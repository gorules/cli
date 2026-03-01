GoRules BRMS — Business rules management system.

Use this tool when the user asks about rules, business rules, rules generation, extracting logic into rules, or anything related to decision management.

WORKFLOW: The first tool to call is **get_system_context** to get instructions, available tools, and information about GoRules.

HTTP ENDPOINTS:
The bridge exposes REST endpoints for local development (port defaults to 41919).

POST /evaluate/{filePath} — evaluate a decision graph
Example: POST http://localhost:41919/evaluate/my-decision
Body: { "context": { "customer": { "tier": "premium" }, "orderTotal": 150 } }
Response: { "result": { "discount": 0.15, "freeShipping": true } }
Optional body fields: "trace" (boolean)

GET /file/{filePath} — retrieve a decision file as JSON
Example: GET http://localhost:41919/file/my-decision
Response: returns the raw decision graph JSON

These endpoints can be used as a loader for ZenEngine:
const engine = new ZenEngine({ loader: async (key) => (await fetch(`http://localhost:41919/file/${key}`)).json() })
