/**
 * SRD 5.2.1 attribution + links, client-safe (plain constants, no server code).
 * Lives under app/constants so both client components and server tooling can
 * import it without tripping the no-restricted-imports (client→server) rule.
 * Wording of SRD_ATTRIBUTION is exact per SRD 5.2.1 page 1 — do not paraphrase.
 */
export const SRD_ATTRIBUTION =
  'This work includes material from the System Reference Document 5.2.1 ' +
  '(“SRD 5.2.1”) by Wizards of the Coast LLC, available at ' +
  'https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the Creative ' +
  'Commons Attribution 4.0 International License, available at ' +
  'https://creativecommons.org/licenses/by/4.0/legalcode.';

export const SRD_LICENSE_URL = 'https://creativecommons.org/licenses/by/4.0/legalcode';
export const SRD_SOURCE_URL = 'https://www.dndbeyond.com/srd';
