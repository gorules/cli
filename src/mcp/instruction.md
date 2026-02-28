GoRules BRMS — Decision graph editor.

WORKFLOW: Call get_current_context at the start of every conversation.
For complex requests (3+ nodes, cross-file), use plan_changes first.
After mutations, verify nodeCount/edgeCount in the response.

CRITICAL RULES:

- Every new node MUST include a type field and an explicit id
- Exactly one inputNode per graph. All nodes must be connected via edges
- passThrough defaults to true — input data merges into output automatically
- Always pass filePath from graph overview to every modifying tool
- Prefer parallel tool calls — add_nodes + add_edges can be issued together

DECISION TABLE CELLS (common error source):
String matches include quotes: "US", "Zone 1"
Everything else is bare: > 50, [0..10], 5, true, amount \* 0.1
Empty string = wildcard

EXPRESSION NODES:

- Reference input fields directly: price, customer.tier
- Reference earlier keys in same node with $. prefix: $.subtotal
- Always use `as` alias in array methods: map(items as item, item.price)

Use simulate_graph for verification. Use validate_expression to check syntax.
Use get_expression_functions to look up available functions.

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
