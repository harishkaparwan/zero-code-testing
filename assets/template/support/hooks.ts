import { createBdd } from 'playwright-bdd';
import { state } from './world';

const { Before } = createBdd();

/** Reset scenario-local values so retries and later scenarios stay independent. */
Before(async () => {
  state.remembered = {};
  delete state.productName;
  delete state.productPrice;
});
