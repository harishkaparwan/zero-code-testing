/** Values carried between steps inside a scenario. */
export const state: {
  remembered: Record<string, string>;
  productName?: string;
  productPrice?: string;
} = {
  remembered: {},
};

/** Test data. Edit these values to test different inputs — no other file needs changing. */
export const testData = {
  searchTerm: process.env.SEARCH_TERM || 'test',
  nonsenseSearchTerm: 'xqzvbnmqzx12345',
  postalCode: '29715',
};
