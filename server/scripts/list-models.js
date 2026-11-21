// Usage: npm run models
// Prints the models your configured provider offers, so you can pick LLM_MODEL.
import { listModels } from '../src/llm.js';

const models = await listModels();
console.log(models.sort().join('\n'));
