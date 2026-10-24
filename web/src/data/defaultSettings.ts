import raw from './defaultSettings.json'
import type { ScraperSettings } from './types'

/**
 * The scraper's default settings. defaultSettings.json is a copy of
 * scraper/default_settings.json (a scraper test checks they match). The
 * database's version 1 holds the same values, seeded by the migration.
 */
export const DEFAULT_SETTINGS = raw as ScraperSettings
