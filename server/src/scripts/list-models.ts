// Usage: npm run models
// Prints the models your configured provider offers, so you can pick LLM_MODEL.
import { listModels } from '../llm.js';

// CommonJS has no top-level `await`, so we use .then() instead.
listModels().then((models) => console.log(models.sort().join('\n')));
