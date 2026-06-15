import { MAX_SECTION_LEVEL } from "../constants.mjs";
import {
  cleanPoolId,
  cleanSectionTitle,
  normalizePoolRole
} from "../utils/pool.mjs";

export function createConfigurationDataClass(ItemChoiceConfigurationData) {
  const { ArrayField, NumberField, SchemaField, StringField } = foundry.data.fields;

  return class LGICLevelGatedItemChoiceConfigurationData extends ItemChoiceConfigurationData {
    static LOCALIZATION_PREFIXES = [
      "LGIC.Advancement",
      ...(ItemChoiceConfigurationData.LOCALIZATION_PREFIXES ?? [])
    ];

    static defineSchema() {
      const schema = super.defineSchema();
      schema.pool = new ArrayField(new SchemaField({
        uuid: new StringField({ required: true, nullable: false, blank: false }),
        minLevel: new NumberField({
          required: false,
          integer: true,
          min: 0,
          nullable: true,
          initial: null,
          label: "LGIC.Config.MinLevel"
        })
      }));

      schema.poolRole = new StringField({
        required: false,
        nullable: false,
        blank: false,
        initial: "standalone",
        label: "LGIC.Config.PoolRole"
      });

      schema.poolId = new StringField({
        required: false,
        nullable: false,
        blank: true,
        initial: "",
        label: "LGIC.Config.PoolId"
      });

      schema.parentPoolId = new StringField({
        required: false,
        nullable: false,
        blank: true,
        initial: "",
        label: "LGIC.Config.ParentPoolId"
      });

      schema.sectionTitles = new SchemaField(Object.fromEntries(
        Array.from({ length: MAX_SECTION_LEVEL }, (_, index) => {
          const level = index + 1;
          return [level, new StringField({
            required: false,
            nullable: false,
            blank: true,
            initial: "",
            label: "LGIC.Config.SectionTitle"
          })];
        })
      ), {
        required: false,
        nullable: false,
        label: "LGIC.Config.SectionTitles"
      });

      return schema;
    }

    static migrateData(source) {
      source = super.migrateData(source) ?? source;
      const pool = Array.isArray(source.pool) ? source.pool : Object.values(source.pool ?? {});

      if ( pool.length ) {
        let lastMin = 1;
        source.pool = pool.map(entry => {
          if ( foundry.utils.getType(entry) === "string" ) return { uuid: entry, minLevel: lastMin };

          const rawMin = entry.minLevel;
          const min = [undefined, null, ""].includes(rawMin) ? lastMin : Number(rawMin);
          const minLevel = Number.isFinite(min) ? min : lastMin;
          lastMin = minLevel;

          return {
            uuid: entry.uuid,
            minLevel
          };
        });
      }

      source.poolRole = normalizePoolRole(source.poolRole);
      source.poolId = cleanPoolId(source.poolId);
      source.parentPoolId = cleanPoolId(source.parentPoolId);

      const sectionTitles = source.sectionTitles ?? {};
      source.sectionTitles = Object.fromEntries(
        Array.from({ length: MAX_SECTION_LEVEL }, (_, index) => {
          const level = index + 1;
          return [level, cleanSectionTitle(sectionTitles[level])];
        })
      );

      return source;
    }
  };
}
