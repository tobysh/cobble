import type { PropertyDefinition } from '../state/types'

/**
 * Starter schema for a brand-new database — exercises every `PropertyType`
 * the table view knows how to render, so creating a database from the
 * sidebar produces something immediately useful to look at rather than an
 * empty column-less table. Users can't yet edit the schema itself (that's a
 * later task); this is just a sensible default, not a fixed template.
 */
export const DEFAULT_DATABASE_PROPERTIES: PropertyDefinition[] = [
  {
    name: 'Status',
    propertyType: {
      type: 'select',
      config: {
        options: [
          { name: 'Todo', color: 'gray' },
          { name: 'In Progress', color: 'blue' },
          { name: 'Done', color: 'green' },
        ],
      },
    },
  },
  {
    name: 'Priority',
    propertyType: {
      type: 'select',
      config: {
        options: [
          { name: 'Low', color: 'gray' },
          { name: 'Medium', color: 'yellow' },
          { name: 'High', color: 'red' },
        ],
      },
    },
  },
  {
    name: 'Tags',
    propertyType: {
      type: 'multi_select',
      config: {
        options: [
          { name: 'Bug', color: 'red' },
          { name: 'Feature', color: 'purple' },
          { name: 'Chore', color: 'brown' },
        ],
      },
    },
  },
  { name: 'Due', propertyType: { type: 'date' } },
  { name: 'Done', propertyType: { type: 'checkbox' } },
]
