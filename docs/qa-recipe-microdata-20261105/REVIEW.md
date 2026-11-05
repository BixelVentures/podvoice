# Valdemarsro microdata compatibility · 5 November 2026

Base51c8f5da6b510ee06f7b7fce22b80cbeb7be6492; importer c3cb5d260e3862aa326359ad7582a1095e1224ef943377f6a1356c542ede065d; existing regression module6dbfd1f1c86cfb900cd9bd76fb75892d27c0d98f46321952099f7df3714dc334. The frozen135candidate is unchanged in its release-owner clone. No new version or installation is claimed here.

## Cause and correction

One public request using the existing importer/resolver to https://www.valdemarsro.dk/hurtig-lasagne/ returned200 text/html, identity,138946bytes. ResponseSHA2561f61dd8b5548c3bb3583baaca2e2962e1a7bb92ded274df1427e040de347c35d has valid Article/WebPage JSON-LD but no Recipe JSON-LD, and one schema.org/Recipe microdata scope. The old JSON-LD-only parser returnednot_recipe and a rejected receipt, with no catalogue entry. This is separate from the user's original invalid-link/iPhone-input incident.

The existing importer now has a narrow microdata fallback only when there is no JSON-LD Recipe. It projects one exact schema.org Recipe into the existing converter and durable store. Nested scopes, semantic duplicate attributes, itemrefs, ambiguous values and unsupported instruction blocks fail closed; Recipe templates/advertisement ancestry are excluded and marked ad content inside a source step rejects the import instead of silently removing words. JSON-LD precedence and its existing rejections remain; malformed JSON-LD does not enable a bypass. No global page-text extraction, generated content, new network call/dependency/import pipeline or UI changes.

## Actual final composed result

[Receipt](receipt.json) records the final exact importer and unchanged renderer pins. The original cached response was replayed only at the external fetch boundary of the existing recipe_e2e_server.py harness. The normal HA phone proxy, POST contract, import_link, temporary disk store, catalogue endpoint and packaged browser renderer remained in use. The before/after probes use separate isolated stores: no terminal rejection was cleared.

Actual final Chrome touch1280×800: normal POST returnssaved/Gemt; catalogue shows the source recipe with17ingredients and3source paragraphs; trusted touch starts cooking, marks ingredient1 and step1; reload resumes step2 with1/17ingredients. Explicit duplicate submission with a tracking parameter returns the same saved receipt. Product journal correlates durable publication. Zero page errors, real home writes or audio. Source response and recipe-bearing screenshots remain private in /private/tmp; full source text is not checked into Git. Root personally inspected detail and resumed screenshots: the unchanged canonical components retain usable spacing, hierarchy and all controls. The UI/component4740PASS and kit review from the unchanged da7b/f210renderer are reused; no redundant full UI rerun.

Focused existing importer module53PASS, Ruff/check/format and targeted mypyPASS; Root Python3.12AST/diff and final targeted mypy/RuffPASS. Scoped Astra source GO verifies the two source pins above and closure of the concrete contamination/attribute findings. No outstanding blocker in this source diff.

## Remaining acceptance and recovery

No real iPhone/iCloud share, Green installation or device acceptance occurred. This does not prove the earlier phone failure was caused by microdata. Existing manual/automatic terminal rejection custody remains unchanged; an already rejected URL is NOT silently retried or republished. Any earlier home receipt needs passive verification and the existing reviewed recovery decision before further action. No home upload or Shortcut run was performed. Real audio and any installation/restart that could resume it remain prohibited until6November08:00CET.

Private inspected image hashes (not embedded recipe text):

- detail-1280.png: f97bb1ee27dd0d83a30a71410f4df2f6d478c5c88b308a6ca94e3739bdaee56e
- resumed-1280.png: 93abd6b6dce2417e4431fbd4c4b4c4de5d35b8343b357b5ffafd7a48637e29a5
