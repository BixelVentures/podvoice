# Stemning: eksplicit cold setup · planlagt31-build

Menneskelig godkendelse `call_995d972f52084767a6f728e3706488da`:20 modelkald/dag,
200/kalendermåned, Europe/Copenhagen, indtil slået fra; Luna,4KiB/128 outputtokens,
ingen carry/refund/retry. Et kaldeloft, ikke et monetært prisloft. Kun initial
musiksession/Andre forslag vælger temaer. Ingen baggrundsrotation eller Spotifydata
hos modellen. Visual-budget og native startvolume/autoplay ændres ikke.

## Transport og faktisk processtop

V2 er eneste installationsansvarlige. Der findes ikke en verificeret CLI-transport
til add-onens private `/data`; det tidligere offline script er ikke den aktuelle
Green-installationsvej. Denne afgrænsede transport bruger kun to eksplicitte
Supervisor-options, ingen HTTP-/exec-/filesystem-API. Begge er tomme som standard.

1. Tag eksisterende HA/add-on/configbackup efter den gældende coupled releaseplan.
2. Stop gammel PodVoice gennem Supervisor og observer faktisk stoppet add-on/proces
   før configændring og31-start. Gem observationen i installationskvitteringen.
   En option, receipt eller fillås beviser ikke, at en anden proces er stoppet.
3. Sæt `podview_mood_policy` til præcis godkendt policy. Brug korrekt groft room_kind
   (kitchen/living_room/other), bevar herefter hele den gemte streng uændret:

```json
{"purpose":"podview_mood_v1","mode":"ongoing","model":"gpt-6-luna","daily_limit":20,"monthly_limit":200,"timezone":"Europe/Copenhagen","room_kind":"kitchen","approval_ref":"call_995d972f52084767a6f728e3706488da"}
```

4. Sæt nye `podview_mood_setup_policy` til følgende **skabelon**, hvor
   `FRESH_NONCE` erstattes med én frisk32–128tegn lowercase hexnonce genereret af
   operatøren. Genbrug samme præcise request ved efterfølgende genstarter:

```json
{"approval_ref":"call_995d972f52084767a6f728e3706488da","policy_sha256":"0b463b685068b864946ff42823e93a0d40089e55aa7683ce4650dbe64e03cfbb","operator_nonce":"FRESH_NONCE","expected_finite_sha256":""}
```

`policy_sha256` er den præcise godkendte OngoingPolicy-fingerprint. Receipt binder
også SHA256 af hele den gemte moodpolicy-streng, inklusive room_kind/formattering.
Requesten accepterer ingen path, beløb, ekstra felter eller andre grænser.

Tom expected_finite_sha256 betyder kun fresh cold bootstrap: både canonical
ledger og purpose-marker skal mangle.30 havde ingen moodfactory, men den faktiske
filtilstand kontrolleres af wrapperen; en antagelse bliver ikke bevis. Hvis finite
v1 findes, kræves faktisk SHA256 af den efter observeret processtop. Hele dens
prepaid used-tal (inklusive20reserverede) føres med i dag/måned/livstid. Kan
operatøren ikke verificere hash via en eksisterende godkendt vej, **stop migration**;
brug ikke et gættet hash eller sletning. Ingen runtimeauto-migration findes.

5. Start31 én gang. Før dette processes moodselector konstrueres, behandles den
   eksplicitte setuprequest. Canonical sti er alene faktisk cfg.settings_path.parent
   plus podview-mood-budget.json. Ingen sti fra optionen accepteres.
6. Gem generisk startup-readback `PodView mood cold setup: ready` eller `rejected`.
   Ingen raw policy/request/nonce logges. Ready beviser kun ledgeropsætning/-åbning;
   det beviser ikke modelkald, providerlatens, gammel processtop eller fysisk lyd.
   Kontrollér også almindelig selectoradmission før den autoriserede brugerprøve.

## Engangsreceipt, fejl og genstart

`podview-mood-setup.json` i samme canonical parent skrives eksklusivt og fsynces
som pending **før** budgetprovisionering. Derefter bruges eksisterende reviewed
provisionkernel; kun efter success skrives complete atomisk. Complete genstarter
validerer samme request+fulde policy+eksisterende ledger og genprovisionerer aldrig.

Bevar samme setuprequest i Supervisor. En ryddet option kan ikke omgå en pending
eller complete receipt. Pending, forkert nonce/policy/hash, korrupt/special fil,
slettet ledger/marker eller en slettet receipt med eksisterende ledger afviser
setup. Ingen automatisk recovery/refill/retry eller ny pulje ved restart. Ved
rejected: ingen moodselector, bevar filer/backup og eskalér konkret fejlsituation
til budgetejer; slet eller redigér ikke state for at få adgang. En crash mellem
kernel-success og complete kan konservativt efterlade ledger med pendingreceipt;
den åbnes ikke via optionclear. Dette kræver separat operatorafklaring.

Deaktivér ved at tømme moodpolicy. Bevar ledger/receipt og setuprequest; reaktivering
kræver samme præcise policy/request. Finite-policy virker fortsat for installationer
uden setupreceipt; v2-ledger må ikke omskrives til v1. Rollback stopper31 først,
gendanner coupled kode/config efter releaseplanen og har moodpolicy tom, indtil
budgetejer har afklaret konservativ ledgerhåndtering. Ingen automatisk tilbagekonvertering.
