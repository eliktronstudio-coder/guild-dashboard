# XD Guild Command Center

XD / ХД is a Russian-language guild interface for ArcheAge. The existing application provides authenticated member access, role-controlled guild information, member records, activities, attendance and treasury/payroll views. Financial figures and protected actions use the existing application data and permission rules; the visual transfer does not change calculation formulas or transfer gold in the game.

The owner approved transferring the visual system of http://xd.200.165.236.194.sslip.io across xd-guild.ru. Current visual guidance is in [docs/DESIGN.md](docs/DESIGN.md); the approved implementation boundary is in [.impeccable/surfaces/reference-ui.md](.impeccable/surfaces/reference-ui.md).

The dashboard supports existing saved panel layouts and a reset control. Its Moscow-time game countdown is an explicit static weekly rotation, separate from real recorded/scheduled activities; it does not create attendance. Existing imagery is reused. Dark/light themes and mobile navigation serve the same real application features, without simulated translations or invented account attributes.
