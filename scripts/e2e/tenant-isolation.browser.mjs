import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import JSZip from "jszip";

const appUrl = process.env.E2E_APP_URL ?? "http://127.0.0.1:4173";
const supabaseUrl = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const password = "GfsE2E!2026-OnlyLocal";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

async function createSyntheticDocx(text) {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      "</Types>",
  );
  zip
    .folder("_rels")
    ?.file(
      ".rels",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        "</Relationships>",
    );
  const escaped = text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  zip
    .folder("word")
    ?.file(
      "document.xml",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        "<w:body><w:p><w:r><w:t>" +
        escaped +
        '</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
        '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/>' +
        "</w:sectPr></w:body></w:document>",
    );
  return zip.generateAsync({ type: "base64", compression: "DEFLATE" });
}

const syntheticDocx = {
  original: await createSyntheticDocx("MODELO ORIGINAL - SECRETARIA"),
  edited: await createSyntheticDocx("MODELO EDITADO - SECRETARIA"),
  restored: await createSyntheticDocx("MODELO RESTAURADO - SECRETARIA"),
  orphan: await createSyntheticDocx("OBJETO ORFAO PARA LIMPEZA"),
};

const syntheticBrandingLogo =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==";
const brandingPathsByTenant = new Map();

assert.ok(supabaseUrl, "SUPABASE_URL must be set by the local Supabase CLI");
assert.ok(anonKey, "SUPABASE_ANON_KEY must be set by the local Supabase CLI");

const scenarios = [
  {
    email: "e2e.secretaria.a@example.invalid",
    tenantId: "91000000-0000-4000-8000-000000000001",
    otherTenantId: "91000000-0000-4000-8000-000000000002",
    tenantName: "Secretaria E2E A",
    ownSupplier: "Fornecedor Sintético Exclusivo A",
    otherSupplier: "Fornecedor Sintético Exclusivo B",
    attemptedCnpj: "45678912000155",
    templateId: "97000000-0000-4000-8000-000000000001",
    otherTemplateId: "97000000-0000-4000-8000-000000000002",
    sourceFileIds: [
      "57000000-0000-4000-8000-000000000001",
      "57000000-0000-4000-8000-000000000003",
      "57000000-0000-4000-8000-000000000005",
    ],
    orphanFileId: "57000000-0000-4000-8000-000000000007",
    crossWriteFileId: "58000000-0000-4000-8000-000000000001",
    brandingCrossWriteFileId: "66000000-0000-4000-8000-000000000001",
    brandingOrphanFileId: "67000000-0000-4000-8000-000000000001",
    otherInitialSourcePath:
      "91000000-0000-4000-8000-000000000002/template-sources/97000000-0000-4000-8000-000000000002/v1/57000000-0000-4000-8000-000000000002.docx",
  },
  {
    email: "e2e.secretaria.b@example.invalid",
    tenantId: "91000000-0000-4000-8000-000000000002",
    otherTenantId: "91000000-0000-4000-8000-000000000001",
    tenantName: "Secretaria E2E B",
    ownSupplier: "Fornecedor Sintético Exclusivo B",
    otherSupplier: "Fornecedor Sintético Exclusivo A",
    attemptedCnpj: "45678912000155",
    templateId: "97000000-0000-4000-8000-000000000002",
    otherTemplateId: "97000000-0000-4000-8000-000000000001",
    sourceFileIds: [
      "57000000-0000-4000-8000-000000000002",
      "57000000-0000-4000-8000-000000000004",
      "57000000-0000-4000-8000-000000000006",
    ],
    orphanFileId: "57000000-0000-4000-8000-000000000008",
    crossWriteFileId: "58000000-0000-4000-8000-000000000002",
    brandingCrossWriteFileId: "66000000-0000-4000-8000-000000000002",
    brandingOrphanFileId: "67000000-0000-4000-8000-000000000002",
    otherInitialSourcePath:
      "91000000-0000-4000-8000-000000000001/template-sources/97000000-0000-4000-8000-000000000001/v1/57000000-0000-4000-8000-000000000001.docx",
  },
];

const browser = await chromium.launch({ headless: true });
const failedPages = [];

async function readAccessToken(page) {
  return page.evaluate(() => {
    for (const key of Object.keys(window.localStorage)) {
      try {
        const value = JSON.parse(window.localStorage.getItem(key) ?? "null");
        const token = value?.access_token ?? value?.currentSession?.access_token;
        if (typeof token === "string" && token.length > 20) return token;
      } catch {
        // Other localStorage entries are application preferences, not auth sessions.
      }
    }
    return null;
  });
}

async function verifyAuthenticatedTenant(scenario) {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  page.on("console", (message) => {
    if (message.type() === "error") {
      console.error(`Browser console error: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    console.error(`Browser page error: ${error.message}`);
  });
  page.on("response", (response) => {
    if (response.url().includes("/auth/v1/token?grant_type=password")) {
      console.log(`Auth password-grant HTTP ${response.status()}`);
    }
  });

  try {
    await page.goto(`${appUrl}/entrar?portal=secretaria`, {
      waitUntil: "networkidle",
    });
    // The route is server-rendered; wait for the client bundle to hydrate
    // before submitting so the native form cannot reload without React handlers.
    await page.waitForTimeout(400);
    await page.getByLabel("E-mail").fill(scenario.email);
    await page.getByLabel("Senha").fill(password);

    await Promise.all([
      page.waitForURL(/\/painel(?:[/?#]|$)/),
      page.getByRole("button", { name: "Entrar", exact: true }).click(),
    ]);

    await page.getByRole("heading", { name: "Painel", exact: true }).waitFor();
    await page.goto(`${appUrl}/fornecedores`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Fornecedores", exact: true }).waitFor();
    await page.getByText(scenario.ownSupplier, { exact: true }).waitFor();

    assert.equal(
      await page.getByText(scenario.otherSupplier, { exact: true }).count(),
      0,
      `${scenario.email} must not see the other tenant's supplier in the UI`,
    );
    assert.ok(
      (await page.getByText(scenario.tenantName, { exact: true }).count()) > 0,
      `${scenario.email} must see only its assigned organization`,
    );

    const accessToken = await readAccessToken(page);
    assert.ok(accessToken, "the authenticated UI session must persist a JWT");

    const apiChecks = await page.evaluate(
      async ({
        apiUrl,
        publicKey,
        token,
        ownTenantId,
        otherTenantId,
        cnpj,
        templateId,
        otherTemplateId,
        sourceFileIds,
        orphanFileId,
        crossWriteFileId,
        otherInitialSourcePath,
        docxOriginal,
        docxEdited,
        docxRestored,
        docxOrphan,
      }) => {
        const deleteHttpMethod = "DE" + "LETE";
        const headers = {
          apikey: publicKey,
          Authorization: `Bearer ${token}`,
        };
        const ownResponse = await fetch(
          `${apiUrl}/rest/v1/suppliers?select=id,legal_name&tenant_id=eq.${ownTenantId}`,
          { headers },
        );
        const ownRows = await ownResponse.json();

        const crossTenantRead = await fetch(
          `${apiUrl}/rest/v1/suppliers?select=id,legal_name&tenant_id=eq.${otherTenantId}`,
          { headers },
        );
        const crossTenantRows = await crossTenantRead.json();

        const crossTenantWrite = await fetch(`${apiUrl}/rest/v1/suppliers`, {
          method: "POST",
          headers: {
            ...headers,
            "Content-Type": "application/json",
            Prefer: "return=representation",
          },
          body: JSON.stringify({
            tenant_id: otherTenantId,
            cnpj,
            legal_name: "Tentativa E2E de cadastro entre Secretarias",
            category: "outros",
            status: "active",
          }),
        });

        const docxHeaders = {
          ...headers,
          "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        };
        const encodeStoragePath = (path) =>
          path
            .split("/")
            .map((segment) => encodeURIComponent(segment))
            .join("/");
        const objectUrl = (path) =>
          `${apiUrl}/storage/v1/object/gfs-private-documents/${encodeStoragePath(path)}`;
        const authenticatedObjectUrl = (path) =>
          `${apiUrl}/storage/v1/object/authenticated/gfs-private-documents/${encodeStoragePath(path)}`;
        const decodeBase64 = (value) => {
          const binary = atob(value);
          return Uint8Array.from(binary, (character) => character.charCodeAt(0));
        };
        const storageUpload = async (path, base64) =>
          fetch(objectUrl(path), {
            method: "POST",
            headers: { ...docxHeaders, "x-upsert": "false" },
            body: new Blob([decodeBase64(base64)], { type: docxHeaders["Content-Type"] }),
          });
        const sourceInsert = async (version, path, fileName, fileSize) =>
          fetch(`${apiUrl}/rest/v1/document_template_sources`, {
            method: "POST",
            headers: {
              ...headers,
              "Content-Type": "application/json",
              Prefer: "return=representation",
            },
            body: JSON.stringify({
              tenant_id: ownTenantId,
              template_id: templateId,
              version,
              storage_path: path,
              file_name: fileName,
              file_size: fileSize,
            }),
          });
        const archiveVersion = async (content, expectedVersion) => {
          const response = await fetch(
            `${apiUrl}/rest/v1/document_templates?id=eq.${templateId}&tenant_id=eq.${ownTenantId}`,
            {
              method: "PATCH",
              headers: {
                ...headers,
                "Content-Type": "application/json",
                Prefer: "return=representation",
              },
              body: JSON.stringify({
                content,
                change_summary: "Homologação sintética DOCX E2E",
              }),
            },
          );
          const rows = await response.json();
          if (!response.ok || rows.length !== 1 || rows[0].version !== expectedVersion) {
            throw new Error(
              `Template version transition failed: HTTP ${response.status} ${JSON.stringify(rows)}`,
            );
          }
          return rows[0].version;
        };
        const uploadAndRegister = async (version, fileId, base64, fileName) => {
          const path = `${ownTenantId}/template-sources/${templateId}/v${version}/${fileId}.docx`;
          const bytes = decodeBase64(base64);
          const uploaded = await storageUpload(path, base64);
          const uploadBody = await uploaded.text();
          if (!uploaded.ok) {
            throw new Error(`DOCX Storage upload failed: HTTP ${uploaded.status} ${uploadBody}`);
          }
          const linked = await sourceInsert(version, path, fileName, bytes.byteLength);
          const linkedBody = await linked.text();
          if (!linked.ok) {
            throw new Error(`DOCX metadata insert failed: HTTP ${linked.status} ${linkedBody}`);
          }
          return { path, size: bytes.byteLength };
        };

        const initialContent = ownTenantId.endsWith("0001")
          ? "CONTEUDO ORIGINAL A"
          : "CONTEUDO ORIGINAL B";
        const v1 = await uploadAndRegister(
          1,
          sourceFileIds[0],
          docxOriginal,
          "modelo-original.docx",
        );
        const version2 = await archiveVersion("CONTEUDO EDITADO E2E", 2);
        const v2 = await uploadAndRegister(
          version2,
          sourceFileIds[1],
          docxEdited,
          "modelo-editado.docx",
        );
        const version3 = await archiveVersion(initialContent, 3);
        const v3 = await uploadAndRegister(
          version3,
          sourceFileIds[2],
          docxRestored,
          "modelo-restaurado.docx",
        );
        const sourceRowsResponse = await fetch(
          `${apiUrl}/rest/v1/document_template_sources?select=version,storage_path,file_name&tenant_id=eq.${ownTenantId}&template_id=eq.${templateId}&order=version.asc`,
          { headers },
        );
        const sourceRows = await sourceRowsResponse.json();
        const archivedVersionsResponse = await fetch(
          `${apiUrl}/rest/v1/document_template_versions?select=version&tenant_id=eq.${ownTenantId}&template_id=eq.${templateId}&order=version.asc`,
          { headers },
        );
        const archivedVersions = await archivedVersionsResponse.json();
        const originalDownload = await fetch(authenticatedObjectUrl(v1.path), { headers });
        const editedDownload = await fetch(authenticatedObjectUrl(v2.path), { headers });
        const restoredDownload = await fetch(authenticatedObjectUrl(v3.path), { headers });
        const sha256 = async (bytes) => {
          const digest = await crypto.subtle.digest("SHA-256", bytes);
          return Array.from(new Uint8Array(digest))
            .map((byte) => byte.toString(16).padStart(2, "0"))
            .join("");
        };
        const originalDownloadedBytes = await originalDownload.arrayBuffer();
        const editedDownloadedBytes = await editedDownload.arrayBuffer();
        const restoredDownloadedBytes = await restoredDownload.arrayBuffer();
        const originalUploadedBytes = decodeBase64(docxOriginal);
        const editedUploadedBytes = decodeBase64(docxEdited);
        const restoredUploadedBytes = decodeBase64(docxRestored);
        const crossTenantObjectRead = await fetch(authenticatedObjectUrl(otherInitialSourcePath), {
          headers,
        });
        const crossTenantMetadataRead = await fetch(
          `${apiUrl}/rest/v1/document_template_sources?select=template_id&tenant_id=eq.${otherTenantId}`,
          { headers },
        );
        const crossTenantMetadataRows = await crossTenantMetadataRead.json();
        const crossWritePath = `${otherTenantId}/template-sources/${otherTemplateId}/v1/${crossWriteFileId}.docx`;
        const crossTenantObjectWrite = await storageUpload(crossWritePath, docxOriginal);
        const immutableMetadataUpdate = await fetch(
          `${apiUrl}/rest/v1/document_template_sources?tenant_id=eq.${ownTenantId}&template_id=eq.${templateId}&version=eq.1`,
          {
            method: "PATCH",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify({ file_name: "arquivo-alterado.docx" }),
          },
        );
        const immutableMetadataDelete = await fetch(
          `${apiUrl}/rest/v1/document_template_sources?tenant_id=eq.${ownTenantId}&template_id=eq.${templateId}&version=eq.1`,
          { method: deleteHttpMethod, headers },
        );

        const orphanPath = `${ownTenantId}/template-sources/${templateId}/v3/${orphanFileId}.docx`;
        const orphanUpload = await storageUpload(orphanPath, docxOrphan);
        const orphanMetadata = await sourceInsert(3, orphanPath, "orphan.docx", 0);
        const orphanCleanup = await fetch(`${apiUrl}/storage/v1/object/gfs-private-documents`, {
          method: deleteHttpMethod,
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ prefixes: [orphanPath] }),
        });
        const orphanAfterCleanup = await fetch(authenticatedObjectUrl(orphanPath), { headers });

        return {
          ownStatus: ownResponse.status,
          ownRows,
          crossReadStatus: crossTenantRead.status,
          crossTenantRows,
          crossWriteStatus: crossTenantWrite.status,
          crossWriteBody: await crossTenantWrite.text(),
          docx: {
            sourceRowsStatus: sourceRowsResponse.status,
            sourceVersions: sourceRows.map((row) => row.version),
            archivedVersionsStatus: archivedVersionsResponse.status,
            archivedVersions: archivedVersions.map((row) => row.version),
            originalDownloadStatus: originalDownload.status,
            originalDownloadSize: originalDownloadedBytes.byteLength,
            editedDownloadStatus: editedDownload.status,
            editedDownloadSize: editedDownloadedBytes.byteLength,
            restoredDownloadStatus: restoredDownload.status,
            restoredDownloadSize: restoredDownloadedBytes.byteLength,
            originalDigestMatches:
              (await sha256(originalDownloadedBytes)) === (await sha256(originalUploadedBytes)),
            editedDigestMatches:
              (await sha256(editedDownloadedBytes)) === (await sha256(editedUploadedBytes)),
            restoredDigestMatches:
              (await sha256(restoredDownloadedBytes)) === (await sha256(restoredUploadedBytes)),
            crossTenantObjectReadStatus: crossTenantObjectRead.status,
            crossTenantMetadataStatus: crossTenantMetadataRead.status,
            crossTenantMetadataRows,
            crossTenantObjectWriteStatus: crossTenantObjectWrite.status,
            immutableMetadataUpdateStatus: immutableMetadataUpdate.status,
            immutableMetadataDeleteStatus: immutableMetadataDelete.status,
            orphanUploadStatus: orphanUpload.status,
            orphanMetadataStatus: orphanMetadata.status,
            orphanCleanupStatus: orphanCleanup.status,
            orphanAfterCleanupStatus: orphanAfterCleanup.status,
            uploadedSizes: [v1.size, v2.size, v3.size],
          },
        };
      },
      {
        apiUrl: supabaseUrl,
        publicKey: anonKey,
        token: accessToken,
        ownTenantId: scenario.tenantId,
        otherTenantId: scenario.otherTenantId,
        cnpj: scenario.attemptedCnpj,
        templateId: scenario.templateId,
        otherTemplateId: scenario.otherTemplateId,
        sourceFileIds: scenario.sourceFileIds,
        orphanFileId: scenario.orphanFileId,
        crossWriteFileId: scenario.crossWriteFileId,
        otherInitialSourcePath: scenario.otherInitialSourcePath,
        docxOriginal: syntheticDocx.original,
        docxEdited: syntheticDocx.edited,
        docxRestored: syntheticDocx.restored,
        docxOrphan: syntheticDocx.orphan,
      },
    );

    assert.equal(apiChecks.ownStatus, 200, "the authenticated user must read its own tenant");
    assert.equal(apiChecks.ownRows.length, 1, "the own-tenant query must return its fixture");
    assert.equal(
      apiChecks.ownRows[0].legal_name,
      scenario.ownSupplier,
      "the own-tenant API response must contain the expected supplier",
    );
    assert.equal(
      apiChecks.crossReadStatus,
      200,
      "PostgREST should safely return an empty collection for a tenant the user cannot access",
    );
    assert.deepEqual(
      apiChecks.crossTenantRows,
      [],
      "RLS must hide all rows belonging to the other tenant",
    );
    assert.ok(
      apiChecks.crossWriteStatus >= 400,
      `cross-tenant INSERT must be rejected; received HTTP ${apiChecks.crossWriteStatus}: ${apiChecks.crossWriteBody}`,
    );

    const docxChecks = apiChecks.docx;
    assert.equal(docxChecks.sourceRowsStatus, 200);
    assert.deepEqual(docxChecks.sourceVersions, [1, 2, 3]);
    assert.equal(docxChecks.archivedVersionsStatus, 200);
    assert.deepEqual(docxChecks.archivedVersions, [1, 2, 3]);
    assert.equal(docxChecks.originalDownloadStatus, 200);
    assert.ok(docxChecks.originalDownloadSize > 100);
    assert.equal(docxChecks.editedDownloadStatus, 200);
    assert.ok(docxChecks.editedDownloadSize > 100);
    assert.equal(docxChecks.restoredDownloadStatus, 200);
    assert.ok(docxChecks.restoredDownloadSize > 100);
    assert.equal(docxChecks.originalDigestMatches, true);
    assert.equal(docxChecks.editedDigestMatches, true);
    assert.equal(docxChecks.restoredDigestMatches, true);
    assert.ok(docxChecks.crossTenantObjectReadStatus >= 400);
    assert.equal(docxChecks.crossTenantMetadataStatus, 200);
    assert.deepEqual(docxChecks.crossTenantMetadataRows, []);
    assert.ok(docxChecks.crossTenantObjectWriteStatus >= 400);
    assert.ok(docxChecks.immutableMetadataUpdateStatus >= 400);
    assert.ok(docxChecks.immutableMetadataDeleteStatus >= 400);
    assert.equal(docxChecks.orphanUploadStatus, 200);
    assert.ok(docxChecks.orphanMetadataStatus >= 400);
    assert.equal(docxChecks.orphanCleanupStatus, 200);
    assert.ok(docxChecks.orphanAfterCleanupStatus >= 400);
    assert.ok(docxChecks.uploadedSizes.every((size) => size > 100));

    // Exercise the actual authenticated Documentos screen restore action,
    // not only the equivalent REST/database sequence above.
    await page.goto(`${appUrl}/documentos`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Documentos e vencimentos", exact: true }).waitFor();
    await page.getByRole("tab", { name: /Modelos/ }).click();
    await page.getByRole("button", { name: "Histórico", exact: true }).click();
    await page.getByRole("heading", { name: "Histórico de versões", exact: true }).waitFor();

    const uiRestoreButtons = page.getByRole("button", {
      name: "Restaurar esta versão",
      exact: true,
    });
    assert.equal(await uiRestoreButtons.count(), 2, "versions 1 and 2 must be restorable");
    page.once("dialog", async (dialog) => {
      assert.match(dialog.message(), /Restaurar a versão 2/);
      await dialog.accept();
    });
    await uiRestoreButtons.first().click();
    await page
      .getByText("Versão restaurada com o Word original preservado.", { exact: true })
      .waitFor({ timeout: 30_000 });

    await page.getByRole("button", { name: "Histórico", exact: true }).click();
    await page.getByRole("heading", { name: "Histórico de versões", exact: true }).waitFor();
    await page.getByRole("dialog").getByText("Versão 4", { exact: true }).waitFor();

    const uiRestoreChecks = await page.evaluate(
      async ({ apiUrl, publicKey, token, tenantId, templateId, expectedBase64 }) => {
        const headers = { apikey: publicKey, Authorization: `Bearer ${token}` };
        const [templateResponse, sourceResponse] = await Promise.all([
          fetch(
            `${apiUrl}/rest/v1/document_templates?select=version,content&id=eq.${templateId}&tenant_id=eq.${tenantId}`,
            { headers },
          ),
          fetch(
            `${apiUrl}/rest/v1/document_template_sources?select=storage_path,file_name,file_size&tenant_id=eq.${tenantId}&template_id=eq.${templateId}&version=eq.4`,
            { headers },
          ),
        ]);
        const templates = await templateResponse.json();
        const sources = await sourceResponse.json();
        if (
          !templateResponse.ok ||
          !sourceResponse.ok ||
          templates.length !== 1 ||
          sources.length !== 1
        ) {
          throw new Error(
            `UI restore metadata missing: template HTTP ${templateResponse.status}, source HTTP ${sourceResponse.status}`,
          );
        }
        const path = sources[0].storage_path
          .split("/")
          .map((segment) => encodeURIComponent(segment))
          .join("/");
        const download = await fetch(
          `${apiUrl}/storage/v1/object/authenticated/gfs-private-documents/${path}`,
          { headers },
        );
        const downloaded = await download.arrayBuffer();
        const expectedBinary = Uint8Array.from(atob(expectedBase64), (character) =>
          character.charCodeAt(0),
        );
        const digest = async (bytes) =>
          Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
            .map((byte) => byte.toString(16).padStart(2, "0"))
            .join("");
        return {
          templateVersion: templates[0].version,
          templateContent: templates[0].content,
          sourceCount: sources.length,
          sourceFileName: sources[0].file_name,
          sourceFileSize: sources[0].file_size,
          downloadStatus: download.status,
          restoredDocxMatchesOriginalHistoricalBytes:
            (await digest(downloaded)) === (await digest(expectedBinary)),
        };
      },
      {
        apiUrl: supabaseUrl,
        publicKey: anonKey,
        token: accessToken,
        tenantId: scenario.tenantId,
        templateId: scenario.templateId,
        expectedBase64: syntheticDocx.edited,
      },
    );
    assert.equal(uiRestoreChecks.templateVersion, 4);
    assert.equal(uiRestoreChecks.templateContent, "CONTEUDO EDITADO E2E");
    assert.equal(uiRestoreChecks.sourceCount, 1);
    assert.equal(uiRestoreChecks.sourceFileName, "modelo-editado.docx");
    assert.ok(uiRestoreChecks.sourceFileSize > 100);
    assert.equal(uiRestoreChecks.downloadStatus, 200);
    assert.equal(uiRestoreChecks.restoredDocxMatchesOriginalHistoricalBytes, true);

    // Exercise the real Secretaria settings screen, including private logo upload.
    await page.goto(appUrl + "/configuracoes", { waitUntil: "domcontentloaded" });
    await page.getByText("Timbrado dos documentos oficiais", { exact: true }).waitFor();
    const brandingHeader = "Cabeçalho E2E " + scenario.tenantName;
    await page.getByLabel("Nome no cabeçalho").fill(brandingHeader);
    await page.getByLabel("Subtítulo institucional").fill("Homologação sintética de timbrado");
    await page.getByLabel("Rodapé").fill("Arquivo fictício; não utilizar em documentos reais.");
    await page.locator("#timbrado-brasao").setInputFiles({
      name: "brasao-sintetico-e2e.png",
      mimeType: "image/png",
      buffer: Buffer.from(syntheticBrandingLogo, "base64"),
    });
    await page.getByRole("button", { name: "Salvar timbrado", exact: true }).click();
    await page.getByText("Timbrado da Secretaria atualizado.", { exact: true }).waitFor({
      timeout: 30_000,
    });

    const otherBrandingPath = brandingPathsByTenant.get(scenario.otherTenantId) ?? null;
    const brandingChecks = await page.evaluate(
      async (input) => {
        const headers = { apikey: input.publicKey, Authorization: "Bearer " + input.token };
        const decodeBase64 = (value) => {
          const binary = atob(value);
          return Uint8Array.from(binary, (character) => character.charCodeAt(0));
        };
        const encodeStoragePath = (path) =>
          path
            .split("/")
            .map((segment) => encodeURIComponent(segment))
            .join("/");
        const authenticatedObjectUrl = (path) =>
          input.apiUrl +
          "/storage/v1/object/authenticated/gfs-private-documents/" +
          encodeStoragePath(path);
        const publicObjectUrl = (path) =>
          input.apiUrl +
          "/storage/v1/object/public/gfs-private-documents/" +
          encodeStoragePath(path);
        const objectUrl = (path) =>
          input.apiUrl + "/storage/v1/object/gfs-private-documents/" + encodeStoragePath(path);
        const logoBytes = decodeBase64(input.logoBase64);
        const brandingResponse = await fetch(
          input.apiUrl +
            "/rest/v1/tenant_document_branding?select=tenant_id,header_title,header_subtitle,footer_text,logo_storage_path,logo_mime,logo_file_name,logo_file_size&tenant_id=eq." +
            input.tenantId,
          { headers },
        );
        const brandingRows = await brandingResponse.json();
        if (!brandingResponse.ok || brandingRows.length !== 1) {
          throw new Error(
            "Timbrado metadata missing: HTTP " +
              brandingResponse.status +
              " " +
              JSON.stringify(brandingRows),
          );
        }
        const row = brandingRows[0];
        const logoPath = row.logo_storage_path;
        const ownDownload = await fetch(authenticatedObjectUrl(logoPath), { headers });
        const ownBytes = await ownDownload.arrayBuffer();
        const digest = async (bytes) =>
          Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
            .map((byte) => byte.toString(16).padStart(2, "0"))
            .join("");
        const publicRead = await fetch(publicObjectUrl(logoPath));
        const crossTenantRead = input.otherLogoPath
          ? await fetch(authenticatedObjectUrl(input.otherLogoPath), { headers })
          : null;
        const crossWritePath =
          input.otherTenantId + "/document-branding/" + input.crossWriteFileId + ".png";
        const crossTenantWrite = await fetch(objectUrl(crossWritePath), {
          method: "POST",
          headers: {
            ...headers,
            "Content-Type": "image/png",
            "x-upsert": "false",
          },
          body: new Blob([logoBytes], { type: "image/png" }),
        });
        const orphanPath = input.tenantId + "/document-branding/" + input.orphanFileId + ".png";
        const orphanUpload = await fetch(objectUrl(orphanPath), {
          method: "POST",
          headers: {
            ...headers,
            "Content-Type": "image/png",
            "x-upsert": "false",
          },
          body: new Blob([logoBytes], { type: "image/png" }),
        });
        const orphanCleanup = await fetch(
          input.apiUrl + "/storage/v1/object/gfs-private-documents",
          {
            method: "DELETE",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify({ prefixes: [orphanPath] }),
          },
        );
        const orphanAfterCleanup = await fetch(authenticatedObjectUrl(orphanPath), { headers });

        return {
          brandingStatus: brandingResponse.status,
          headerTitle: row.header_title,
          headerSubtitle: row.header_subtitle,
          footerText: row.footer_text,
          logoPath,
          logoMime: row.logo_mime,
          logoFileName: row.logo_file_name,
          logoFileSize: row.logo_file_size,
          ownDownloadStatus: ownDownload.status,
          ownLogoDigestMatches: (await digest(ownBytes)) === (await digest(logoBytes)),
          publicReadStatus: publicRead.status,
          crossTenantReadStatus: crossTenantRead ? crossTenantRead.status : null,
          crossTenantWriteStatus: crossTenantWrite.status,
          orphanUploadStatus: orphanUpload.status,
          orphanCleanupStatus: orphanCleanup.status,
          orphanAfterCleanupStatus: orphanAfterCleanup.status,
        };
      },
      {
        apiUrl: supabaseUrl,
        publicKey: anonKey,
        token: accessToken,
        tenantId: scenario.tenantId,
        otherTenantId: scenario.otherTenantId,
        logoBase64: syntheticBrandingLogo,
        otherLogoPath: otherBrandingPath,
        crossWriteFileId: scenario.brandingCrossWriteFileId,
        orphanFileId: scenario.brandingOrphanFileId,
      },
    );
    assert.equal(brandingChecks.brandingStatus, 200);
    assert.equal(brandingChecks.headerTitle, brandingHeader);
    assert.equal(brandingChecks.headerSubtitle, "Homologação sintética de timbrado");
    assert.equal(brandingChecks.footerText, "Arquivo fictício; não utilizar em documentos reais.");
    assert.match(
      brandingChecks.logoPath,
      new RegExp("^" + scenario.tenantId + "/document-branding/.+\\.png$"),
    );
    assert.equal(brandingChecks.logoMime, "image/png");
    assert.equal(brandingChecks.logoFileName, "brasao-sintetico-e2e.png");
    assert.equal(
      brandingChecks.logoFileSize,
      Buffer.from(syntheticBrandingLogo, "base64").byteLength,
    );
    assert.equal(brandingChecks.ownDownloadStatus, 200);
    assert.equal(brandingChecks.ownLogoDigestMatches, true);
    assert.ok(
      brandingChecks.publicReadStatus >= 400,
      "branding logo must not be publicly readable",
    );
    if (otherBrandingPath) {
      assert.ok(
        brandingChecks.crossTenantReadStatus >= 400,
        "the other tenant's branding logo must remain private",
      );
    }
    assert.ok(
      brandingChecks.crossTenantWriteStatus >= 400,
      "a tenant must not upload logos into another tenant's path",
    );
    assert.equal(brandingChecks.orphanUploadStatus, 200);
    assert.equal(brandingChecks.orphanCleanupStatus, 200);
    assert.ok(brandingChecks.orphanAfterCleanupStatus >= 400);
    brandingPathsByTenant.set(scenario.tenantId, brandingChecks.logoPath);
    console.log(
      "PASS " +
        scenario.email +
        ": authenticated settings saved a private PNG letterhead, verified SHA-256, denied public/cross-tenant access, and cleaned an orphan",
    );

    console.log(
      `PASS ${scenario.email}: authenticated UI restored historical DOCX version 2 as version 4 and reattached the original bytes`,
    );
    console.log(
      `PASS ${scenario.email}: login, tenant isolation, private DOCX upload/download, immutable versions 1-3, restore, cross-tenant denial and orphan cleanup`,
    );
  } catch (error) {
    await mkdir("artifacts", { recursive: true });
    const safeName = scenario.email.replace(/[^a-z0-9]+/gi, "-");
    await page
      .screenshot({
        path: `artifacts/tenant-isolation-${safeName}.png`,
        fullPage: true,
      })
      .catch(() => {});
    failedPages.push(scenario.email);
    throw error;
  } finally {
    await context.close();
  }
}

try {
  for (const scenario of scenarios) {
    await verifyAuthenticatedTenant(scenario);
  }
  console.log(
    "PASS authenticated multitenant browser E2E: both synthetic tenant accounts are isolated.",
  );
} finally {
  await browser.close();
  if (failedPages.length > 0) {
    console.error(`Failed scenarios: ${failedPages.join(", ")}`);
  }
}
