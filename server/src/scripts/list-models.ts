// Usage: npm run models            -> models of the default provider (LLM_*)
//        npm run models -- large   -> models of the long-document provider (LARGE_LLM_*)
// Prints the models a provider offers, so you can pick a model name for .env.
import { getProvider, listModels, type ProviderName } from '../llm.js';

const name: ProviderName = process.argv[2] === 'large' ? 'large' : 'default';
const provider = getProvider(name);
if (!provider) {
  console.error(`The "${name}" provider is not configured in .env`);
  process.exit(1);
}

// CommonJS has no top-level `await`, so we use .then() instead.
listModels(provider).then((models) => console.log(models.sort().join('\n')));
