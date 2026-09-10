-- 0014 — two enum values: product_class 'non_product', relation_kind 'spare_of'.
--
-- NON_PRODUCT. `servers-unified-computing` holds ordering artefacts that are not parts at all —
-- UCS-SID-WKL-SAP is a solution ID tag, UCSC-COPC-BIOS is a configuration option on an order line.
-- They currently sit in `hardware` and are counted in every population, denominator and mean for
-- the category, so every percentage is over a base that includes rows nobody can specify.
--
-- THEY ARE KEPT AS ROWS, not deleted, and that is deliberate: netzspec is a part-number lookup, and
-- "UCS-SID-WKL-SAP" is exactly the kind of line someone pastes out of a quote to find out what it
-- is. "An ordering artefact, not a product" is a real answer and a better one than a 404.
--
-- THE DISTINCTION FROM `unknown` IS THE USEFUL PART. Both are excluded from SCORING. Only
-- non_product is excluded from the POPULATION COUNT as well, because `unknown` is unfinished work
-- — a part whose class nobody has determined yet, which must stay visible in the denominator so it
-- keeps being counted as a thing to do. non_product is finished: it has been determined, and the
-- determination is that it is not a product.
--
-- SPARE_OF. Cisco's `=` suffix means "the spare of the part without it": GLC-TE= is the spare of
-- GLC-TE, the identical hardware in service packaging. 20,695 cisco SKUs carry it. It is the one
-- part-to-part relation derivable from a pure string rule with no document reading at all, and it
-- is the first typed edge in a catalogue whose inheritance today is 35,133 facts sourced from
-- GROUPS and 0 from parts.
--
-- ADDITIVE AND SAFE UNDER THE PREVIOUS RELEASE (db/migrate.ts is forward-only): adding an enum
-- member changes nothing that already reads or writes the type. NOTHING IS ASSIGNED HERE — a
-- postgres transaction may add an enum value or use it, not both, so the rows that take these
-- values are written by their own runs afterwards.

ALTER TYPE product_class ADD VALUE IF NOT EXISTS 'non_product';
ALTER TYPE relation_kind ADD VALUE IF NOT EXISTS 'spare_of';
