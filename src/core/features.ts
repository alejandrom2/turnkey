/** Work that ships off until it is ready; flip a flag to bring it back everywhere at once. */
export const FEATURES = {
	/** The idle pet: its walks, the Preview pet button and its setting in the settings window. */
	idlePet: false,
} as const;
