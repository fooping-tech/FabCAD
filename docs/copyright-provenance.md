# FabCAD copyright provenance: repository evidence and remaining legal decisions

Checked: 2026-10-08. **Evidence inventory, not a legal opinion or proof of ownership.**

## Auditable repository signals

GitHub REST API was used to enumerate the full **main-branch history** as of this review:
`GET /repos/fooping-tech/FabCAD/commits?sha=main&per_page=100&page=1`
and `page=2`.

- 110 main-branch commits had the Git author email `fukuhala@gmail.com`, with two display names (`Fooping` and `fooping-tech`). Git committer fields are not the same as author fields: merges may have GitHub as the committer.
- The repository's `pulls?state=all&per_page=100` collection returned 35 pull requests; **all 35 PR creators** were the account `fooping-tech`.
- No *different author email* was found in the Git metadata inspected. This is evidence that there are no externally attributed contributors in this set of commits; **it does not prove that every line of code is original, that no external code was pasted, or that this account legally owns the copyright**.
- Changes introduced by the license-review branch should be reviewed separately because those commits are not part of the main-branch history above.

Repository evidence is not evidence of legal assignment, employer ownership, contractor agreements, external input licensing, or whether computer-generated suggestions include copyrighted text. The developer must confirm these details.

## Questions for the copyright holder / reviewer

- [ ] Confirm the **legal licensor identity** and the proper copyright notice. Do not assume the GitHub account name is a legal entity.
- [ ] Confirm the project was developed independently of any employer's protected code or relevant employment-created-program provisions (Japanese Copyright Act Art. 15(2)); check applicable agreements and work rules.
- [ ] Confirm all copied example/template code and embedded assets are attributed and compatibly licensed. In particular, keep the third-party modules and fonts outside the FabCAD original-code license.
- [ ] For future external contributions, choose whether to require a CLA with commercial relicensing rights; a DCO alone does not automatically grant extra commercial sublicensing rights.
- [ ] Have a Japanese-qualified legal professional review the custom license and any commercial sublicensing agreement before asserting enforceability.

**Reviewer decision:** pending. The Source Available License may only cover original code that the named licensor actually owns or is authorized to license.

## Follow-ups

- [FabCAD Source Available License](../LICENSE)
- [Third-party notices](../THIRD_PARTY_NOTICES.md)
- [OCCT / LGPL distribution evidence](occt-wasm-lgpl.md)
- [Legal review PR #49](https://github.com/fooping-tech/FabCAD/pull/49)
