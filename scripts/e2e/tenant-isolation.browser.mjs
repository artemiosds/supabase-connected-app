import { verifyAnnualDemand } from "./annual-demand.browser.mjs";
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";

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
    await page.locator("#senha").fill(password);

    await Promise.all([
      page.waitForURL(/\/painel(?:[/?#]|$)/),
      page.getByRole("button", { name: "Entrar", exact: true }).click(),
    ]);

    await page
      .getByRole("heading", { name: "Seu trabalho, com mais clareza.", exact: true })
      .waitFor();
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
    await page.waitForFunction(
      () =>
        document.querySelectorAll("button").length > 0 &&
        [...document.querySelectorAll("button")].filter(
          (button) => button.textContent?.trim() === "Restaurar esta versão",
        ).length === 2,
      { timeout: 30_000 },
    );
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
    await page.getByRole("heading", { name: "Minha conta", exact: true }).waitFor();
    await page.getByText("E-mail de acesso", { exact: true }).waitFor();
    await page.getByRole("main").getByText(scenario.email, { exact: true }).waitFor();
    await page.getByText("Organização selecionada", { exact: true }).waitFor();
    await page
      .getByRole("main")
      .getByText("Organização selecionada", { exact: true })
      .locator("..")
      .getByText(scenario.tenantName, { exact: true })
      .waitFor();
    // The settings route opens on "Minha conta"; select the documents category before
    // asserting or exercising the tenant-specific letterhead form.
    await page.getByRole("button", { name: /Documentos oficiais/ }).click();
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

async function verifyProcurementLifecycle() {
  const tenantId = "91000000-0000-4000-8000-000000000001";
  const supplierId = "94000000-0000-4000-8000-000000000001";
  const processNumber = "E2E-PROC-2026-001";
  const processTitle = "Aquisição sintética de insumos de saúde";
  const itemDescription = "Seringa descartável E2E";
  const contractNumber = "E2E-CONTRATO-2026-001";
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.addInitScript((id) => localStorage.setItem("gfs:organizacao-id", id), tenantId);
  page.setDefaultTimeout(30_000);

  try {
    await page.goto(`${appUrl}/entrar?portal=secretaria`, { waitUntil: "networkidle" });
    await page.getByLabel("E-mail").fill("e2e.secretaria.a@example.invalid");
    await page.locator("#senha").fill(password);
    await Promise.all([
      page.waitForURL(/\/painel(?:[/?#]|$)/),
      page.getByRole("button", { name: "Entrar", exact: true }).click(),
    ]);

    const token = await readAccessToken(page);
    assert.ok(token, "the procurement workflow must use an authenticated session");
    const readRows = async (table, filters, select = "*") =>
      page.evaluate(
        async ({ apiUrl, publicKey, token, table, filters, select }) => {
          const url = new URL(`/rest/v1/${table}`, apiUrl);
          url.searchParams.set("select", select);
          for (const [column, value] of Object.entries(filters)) {
            url.searchParams.set(column, `eq.${value}`);
          }
          const response = await fetch(url, {
            headers: { apikey: publicKey, Authorization: `Bearer ${token}` },
          });
          return { status: response.status, body: await response.json() };
        },
        { apiUrl: supabaseUrl, publicKey: anonKey, token, table, filters, select },
      );

    const callRpc = async (functionName, args) =>
      page.evaluate(
        async ({ apiUrl, publicKey, token, functionName, args }) => {
          const response = await fetch(`${apiUrl}/rest/v1/rpc/${functionName}`, {
            method: "POST",
            headers: {
              apikey: publicKey,
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(args),
          });
          return { status: response.status, body: await response.json().catch(() => null) };
        },
        { apiUrl: supabaseUrl, publicKey: anonKey, token, functionName, args },
      );

    const updateRows = async (table, filters, values) =>
      page.evaluate(
        async ({ apiUrl, publicKey, token, table, filters, values }) => {
          const url = new URL(`/rest/v1/${table}`, apiUrl);
          for (const [column, value] of Object.entries(filters)) {
            url.searchParams.set(column, `eq.${value}`);
          }
          const response = await fetch(url, {
            method: "PATCH",
            headers: {
              apikey: publicKey,
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
              Prefer: "return=representation",
            },
            body: JSON.stringify(values),
          });
          return { status: response.status, body: await response.json().catch(() => null) };
        },
        { apiUrl: supabaseUrl, publicKey: anonKey, token, table, filters, values },
      );

    await page.goto(`${appUrl}/processos`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Processos de contratação", exact: true }).waitFor();
    await page.getByRole("button", { name: "Novo processo", exact: false }).click();
    const createDialog = page
      .getByRole("dialog")
      .filter({ hasText: "Novo processo de contratação" });
    const processForm = createDialog.locator("form");
    const processInputs = processForm.locator("input");
    await processInputs.nth(0).fill(processNumber);
    await processInputs.nth(1).fill(processTitle);
    await processInputs.nth(2).fill("Farmácia E2E");
    await processInputs.nth(3).fill("Equipe sintética");
    await processInputs.nth(4).fill("140");
    await createDialog.getByRole("button", { name: "Criar processo", exact: true }).click();
    await createDialog.waitFor({ state: "hidden" });

    const processCard = page
      .getByRole("button")
      .filter({ hasText: processNumber })
      .filter({ hasText: processTitle });
    await processCard.waitFor();
    await processCard.click();
    const detailDialog = page.getByRole("dialog").filter({ hasText: processNumber });
    await detailDialog.getByText("Etapa atual:", { exact: false }).waitFor();

    await detailDialog.getByRole("button", { name: "Avançar etapa", exact: false }).click();
    await page.getByText(/Conclua os 2 item\(ns\) pendente\(s\)/).waitFor();
    const beforeAdvance = await readRows(
      "procurement_processes",
      {
        tenant_id: tenantId,
        number: processNumber,
      },
      "id,stage,status",
    );
    assert.equal(beforeAdvance.status, 200);
    assert.equal(beforeAdvance.body.length, 1);
    assert.equal(beforeAdvance.body[0].stage, "planejamento");

    await detailDialog
      .getByRole("checkbox", { name: "Concluir: DFD — Documento de Formalização da Demanda" })
      .click();
    await detailDialog.getByRole("checkbox", { name: "Concluir: Previsão no PCA" }).click();
    await detailDialog.getByRole("button", { name: "Avançar etapa", exact: false }).click();

    let transitioned = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      const current = await readRows(
        "procurement_processes",
        {
          tenant_id: tenantId,
          number: processNumber,
        },
        "id,stage,status",
      );
      if (current.body?.[0]?.stage === "estudos") {
        transitioned = true;
        break;
      }
      await page.waitForTimeout(250);
    }
    assert.equal(
      transitioned,
      true,
      "the process must advance after its current-stage checklist is complete",
    );
    const createdProcess = await readRows(
      "procurement_processes",
      {
        tenant_id: tenantId,
        number: processNumber,
      },
      "id,stage,status",
    );
    const processId = createdProcess.body[0].id;
    assert.equal(createdProcess.body[0].status, "em_andamento");

    const checklist = await readRows(
      "process_items",
      {
        tenant_id: tenantId,
        process_id: processId,
      },
      "stage,title,is_done",
    );
    assert.equal(checklist.status, 200);
    assert.equal(checklist.body.length, 17, "the standard checklist must be created atomically");
    assert.equal(
      checklist.body.filter((item) => item.stage === "planejamento" && item.is_done).length,
      2,
    );

    const crossTenantRead = await readRows(
      "procurement_processes",
      { number: processNumber },
      "id,tenant_id,number",
    );
    assert.equal(crossTenantRead.status, 200);
    assert.equal(crossTenantRead.body.length, 1);
    assert.equal(
      crossTenantRead.body[0].tenant_id,
      tenantId,
      "an unscoped query must not reveal the other tenant's process with the same number",
    );

    await detailDialog
      .getByRole("button", { name: "Itens, preços e orçamento", exact: false })
      .click();
    const composition = page.getByRole("dialog").filter({
      hasText: `Composição da contratação — ${processNumber}`,
    });
    await composition.waitFor();

    await composition.getByRole("button", { name: "Adicionar item", exact: true }).click();
    const itemForm = composition.locator("form").filter({ hasText: "Descrição do item *" });
    const itemInputs = itemForm.locator("input");
    await itemInputs.nth(0).fill(itemDescription);
    await itemInputs.nth(1).fill("unidade");
    await itemInputs.nth(2).fill("2");
    await itemInputs.nth(3).fill("70");
    await itemInputs.nth(4).fill("Almoxarifado sintético");
    await itemForm.getByRole("button", { name: "Salvar item", exact: true }).click();
    await composition.getByText(itemDescription, { exact: false }).waitFor();

    async function addQuote(source, unitPrice, deliveryCost, referenceUrl, supplierName = null) {
      await composition.getByRole("button", { name: "Nova cotação", exact: true }).click();
      const quoteForm = composition.locator("form").filter({
        hasText: "Fonte da cotação / fornecedor *",
      });
      const field = (label) => quoteForm.getByText(label, { exact: true }).locator("..");
      if (supplierName) {
        await field("Fornecedor cadastrado (opcional)").getByRole("combobox").click();
        await page.getByPlaceholder("Nome, CNPJ ou município").fill("12.345.678/0001-95");
        await page.getByRole("option", { name: supplierName, exact: true }).click();
      }

      await field("Fonte da cotação / fornecedor *").locator("input").fill(source);
      await field("Data e hora de acesso à fonte").locator("input").fill("2026-11-16T10:00");
      await field("Data da cotação *").locator("input").fill("2026-11-16");
      await field("Quantidade cotada *").locator("input").fill("2");
      await field("Preço unitário (R$) *").locator("input").fill(unitPrice);
      await field("Frete (R$)").locator("input").fill(deliveryCost);
      await field("Referência HTTPS").locator("input").fill(referenceUrl);

      if (supplierName) {
        await field("Data do envio da solicitação formal *").locator("input").fill("2026-11-16");
        await field("Prazo concedido para resposta *").locator("input").fill("2026-11-20");
        await field("Justificativa da escolha deste fornecedor *")
          .locator("textarea")
          .fill("Fornecedor consultado por compatibilidade técnica e disponibilidade regional.");
        await field("CPF/CNPJ do fornecedor *").locator("input").fill("12345678000195");
        await field("Responsável pela proposta *")
          .locator("input")
          .fill("Representante Sintético E2E");
        await field("E-mail de contato *")
          .locator("input")
          .fill("propostas@fornecedor-e2e.invalid");
        await field("Telefone de contato *").locator("input").fill("92999990000");
        await field("Endereço do fornecedor *")
          .locator("input")
          .fill("Rua E2E, 100, Centro, Oriximiná/PA, CEP 68270-000");
        await quoteForm.locator('input[type="file"]').setInputFiles({
          name: "proposta-formal-e2e.pdf",
          mimeType: "application/pdf",
          buffer: Buffer.from(
            "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n",
          ),
        });
      }

      await quoteForm.getByRole("button", { name: "Salvar cotação", exact: true }).click();
      await page
        .getByText("Cotação registrada com rastreabilidade da fonte.", { exact: true })
        .waitFor();
    }

    await addQuote(
      "Fornecedor Sintético Exclusivo A",
      "10",
      "10",
      "https://example.invalid/e2e-cotacao-a",
      "Fornecedor Sintético Exclusivo A",
    );
    await addQuote(
      "Fonte pública sintética B",
      "11",
      "20",
      "https://example.invalid/e2e-cotacao-b",
    );

    await composition.getByRole("tab", { name: "Orçamento", exact: true }).click();
    await composition.getByRole("button", { name: "Adicionar dotação", exact: true }).click();
    const budgetForm = composition.locator("form");
    const budgetInputs = budgetForm.locator("input");
    await budgetInputs.nth(0).fill("2026");
    await budgetInputs.nth(1).fill("Fundo Municipal de Saúde E2E");
    await budgetInputs.nth(2).fill("10.301.0001");
    await budgetInputs.nth(3).fill("2.001");
    await budgetInputs.nth(4).fill("3.3.90.30");
    await budgetInputs.nth(5).fill("15000000");
    await budgetInputs.nth(6).fill("140");
    await budgetForm.getByRole("button", { name: "Salvar dotação", exact: true }).click();
    // Reloading the structured data remounts Tabs with its default "items" tab.
    // Reopen the budget tab before asserting the persisted allocation.
    await composition.getByRole("tab", { name: "Orçamento", exact: true }).click();
    await composition.getByText(/Fundo Municipal de Saúde E2E/).waitFor();

    await composition.getByRole("tab", { name: "Itens e preços", exact: true }).click();
    await composition.getByRole("button", { name: "Mapa comparativo (2)", exact: true }).click();
    const mapDialog = page.getByRole("dialog").filter({
      hasText: `Mapa comparativo de preços — ${processNumber}`,
    });
    await mapDialog.getByText("2 cotação(ões) válidas", { exact: true }).waitFor();
    await mapDialog.getByText(/15,00/).first().waitFor();
    await mapDialog.getByText(/Frete rateado pela quantidade cotada/).waitFor();
    await mapDialog.getByRole("button", { name: "Fechar mapa", exact: true }).click();
    const supplierQuote = composition
      .getByText("Fornecedor Sintético Exclusivo A", { exact: true })
      .locator("xpath=../..");
    await supplierQuote.getByRole("button", { name: "Usar como referência", exact: true }).click();
    await composition.getByText("Referência escolhida", { exact: true }).waitFor();

    const items = await readRows(
      "procurement_items",
      {
        tenant_id: tenantId,
        process_id: processId,
      },
      "id,description,quantity,estimated_unit_price,estimated_total,is_active",
    );
    assert.equal(items.status, 200);
    assert.equal(items.body.length, 1);
    assert.equal(items.body[0].description, itemDescription);
    const quotes = await page.evaluate(
      async ({ apiUrl, publicKey, token, tenantId, itemId }) => {
        const url = new URL("/rest/v1/procurement_price_quotes", apiUrl);
        url.searchParams.set(
          "select",
          "id,source_name,supplier_id,selected_for_estimate,contract_id,total_price,unit_price,delivery_cost,quantity",
        );
        url.searchParams.set("tenant_id", `eq.${tenantId}`);
        url.searchParams.set("procurement_item_id", `eq.${itemId}`);
        const response = await fetch(url, {
          headers: { apikey: publicKey, Authorization: `Bearer ${token}` },
        });
        return { status: response.status, body: await response.json() };
      },
      { apiUrl: supabaseUrl, publicKey: anonKey, token, tenantId, itemId: items.body[0].id },
    );
    assert.equal(quotes.status, 200);
    assert.equal(quotes.body.length, 2);
    const selectedQuote = quotes.body.find((quote) => quote.selected_for_estimate);
    assert.ok(selectedQuote);
    assert.equal(selectedQuote.supplier_id, supplierId);
    assert.equal(selectedQuote.total_price, 30);

    await page.goto(`${appUrl}/contratos`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Contratos e vencimentos", exact: true }).waitFor();
    await page.getByRole("button", { name: "Central de renovações", exact: true }).click();
    await page.getByRole("heading", { name: "Central de renovações", exact: true }).waitFor();
    await page.getByRole("textbox", { name: "Pesquisar contratos" }).fill("E2E-2026-A");
    await page.getByRole("button", { name: "Iniciar acompanhamento", exact: true }).click();
    await page.getByText(/Acompanhamento registrado em/).waitFor();
    await page.getByRole("button", { name: "Registrar aditivo formalizado", exact: true }).click();
    const renewalDialog = page
      .getByRole("dialog")
      .filter({ hasText: "Termo aditivo — Contrato E2E-2026-A" });
    await renewalDialog.getByRole("button", { name: "Cancelar", exact: true }).click();
    await page.getByRole("button", { name: /Contratos e atas/ }).click();
    console.log(
      "PASS renewal workspace: upcoming contract, persisted follow-up and amendment shortcut",
    );
    await page.getByRole("button", { name: "Novo contrato", exact: false }).click();
    const contractDialog = page.getByRole("dialog").filter({ hasText: "Novo contrato" });
    await contractDialog.getByPlaceholder("042/2026").fill(contractNumber);
    await contractDialog.locator("textarea").first().fill("Fornecimento sintético de seringas E2E");
    const contractComboboxes = contractDialog.getByRole("combobox");
    await contractComboboxes.nth(2).click();
    await page.getByRole("option", { name: new RegExp(processNumber) }).click();
    await contractComboboxes.nth(3).click();
    await page.getByPlaceholder("Nome, CNPJ ou município").fill("sintetico exclusivo");
    await page
      .getByRole("option", { name: "Fornecedor Sintético Exclusivo A", exact: true })
      .click();
    const contractInputs = contractDialog.locator("input");
    await contractInputs.nth(1).fill("140");
    await contractInputs.nth(2).fill("2026-11-16");
    await contractInputs.nth(3).fill("2027-11-15");
    await contractInputs.nth(4).fill("Gestor sintético");
    await contractInputs.nth(5).fill("Fiscal sintético");
    await contractDialog.getByRole("button", { name: "Salvar contrato", exact: true }).click();
    await page.getByText(/Contrato cadastrado e 1 cotaç.*vinculada/).waitFor();
    await page.getByText(new RegExp(contractNumber)).waitFor();

    const contractRows = await readRows(
      "contracts",
      { tenant_id: tenantId, number: contractNumber },
      "id,process_id,supplier_id,total_value,status,end_date",
    );
    assert.equal(contractRows.status, 200);
    assert.equal(contractRows.body.length, 1);
    assert.equal(contractRows.body[0].process_id, processId);
    assert.equal(contractRows.body[0].supplier_id, supplierId);
    assert.equal(contractRows.body[0].total_value, 140);

    const linkedQuotes = await page.evaluate(
      async ({ apiUrl, publicKey, token, tenantId, itemId }) => {
        const url = new URL("/rest/v1/procurement_price_quotes", apiUrl);
        url.searchParams.set("select", "contract_id,selected_for_estimate,supplier_id");
        url.searchParams.set("tenant_id", `eq.${tenantId}`);
        url.searchParams.set("procurement_item_id", `eq.${itemId}`);
        const response = await fetch(url, {
          headers: { apikey: publicKey, Authorization: `Bearer ${token}` },
        });
        return { status: response.status, body: await response.json() };
      },
      { apiUrl: supabaseUrl, publicKey: anonKey, token, tenantId, itemId: items.body[0].id },
    );
    assert.equal(linkedQuotes.status, 200);
    assert.ok(
      linkedQuotes.body.some(
        (quote) =>
          quote.contract_id === contractRows.body[0].id &&
          quote.selected_for_estimate &&
          quote.supplier_id === supplierId,
      ),
      "the contract must retain the selected supplier quote",
    );

    // Contract/ARP item ledger: create, consume, inspect balance, reverse, and preserve history.
    await page
      .getByRole("button", { name: `Itens e saldo do contrato ${contractNumber}`, exact: true })
      .click();
    const itemPanel = page
      .locator("section")
      .filter({ hasText: "Itens de " + contractNumber })
      .first();
    await itemPanel.getByRole("button", { name: "Adicionar item", exact: true }).click();
    let contractItemDescription = "Item contratual E2E " + tenantId.slice(-1);
    const contractItemForm = itemPanel.locator("form").filter({ hasText: "Descrição do item" });
    const itemFields = contractItemForm.locator("input");
    await itemFields.nth(0).fill(contractItemDescription);
    await itemFields.nth(1).fill("unidade");
    await itemFields.nth(2).fill("Item de teste");
    await itemFields.nth(3).fill("2");
    await itemFields.nth(4).fill("10");
    await contractItemForm.getByRole("button", { name: "Salvar item", exact: true }).click();
    await itemPanel.getByText(contractItemDescription, { exact: true }).waitFor();
    await itemPanel.getByRole("button", { name: "Editar item", exact: true }).click();
    contractItemDescription += " editado";
    await itemPanel
      .locator("form")
      .filter({ hasText: "Editar descrição do item" })
      .locator("input")
      .nth(0)
      .fill(contractItemDescription);
    await itemPanel.getByRole("button", { name: "Salvar alterações", exact: true }).click();
    await itemPanel.getByText(contractItemDescription, { exact: true }).waitFor();
    await itemPanel.getByRole("button", { name: "Registrar consumo", exact: true }).click();
    await itemPanel.getByLabel("Quantidade a consumir *").fill("1");
    await itemPanel.getByLabel("Motivo do consumo *").fill("Consumo de homologação E2E");
    await itemPanel.getByRole("button", { name: "Registrar consumo", exact: true }).last().click();
    await itemPanel.getByText("Saldo: 1 unidade", { exact: true }).waitFor();
    const contractItemRows = await readRows(
      "contract_items",
      { tenant_id: tenantId, contract_id: contractRows.body[0].id },
      "id",
    );
    assert.equal(contractItemRows.body.length, 1);
    const contractItemId = contractItemRows.body[0].id;
    const unitChangeAttempt = await updateRows(
      "contract_items",
      { tenant_id: tenantId, id: contractItemId },
      { unit: "caixa" },
    );
    assert.ok(unitChangeAttempt.status >= 400, "unit changes after a movement must be rejected");
    const unitPriceChangeAttempt = await updateRows(
      "contract_items",
      { tenant_id: tenantId, id: contractItemId },
      { unit_value: 11 },
    );
    assert.ok(
      unitPriceChangeAttempt.status >= 400,
      "unit price changes after a movement must be rejected",
    );
    const quantityReductionAttempt = await updateRows(
      "contract_items",
      { tenant_id: tenantId, id: contractItemId },
      { quantity_total: 0.5 },
    );
    assert.ok(
      quantityReductionAttempt.status >= 400,
      "item quantity cannot be reduced below net consumption",
    );
    const excessConsumption = await callRpc("record_contract_item_consumption", {
      p_tenant_id: tenantId,
      p_contract_item_id: contractItemId,
      p_quantity: 2,
      p_reason: "Tentativa de consumo acima do saldo",
      p_reference_number: null,
    });
    assert.ok(excessConsumption.status >= 400, "consumption above the available balance must fail");
    await itemPanel.getByText("Histórico de movimentações (1)", { exact: true }).click();
    await itemPanel
      .getByPlaceholder("Justificativa do estorno (mínimo 10 caracteres)")
      .fill("Estorno de homologação E2E");
    await itemPanel.getByRole("button", { name: /Estornar/ }).click();
    await itemPanel.getByText("Saldo: 2 unidade", { exact: true }).waitFor();
    await itemPanel.getByText("Histórico de movimentações (2)", { exact: true }).waitFor();
    const movementRows = await readRows(
      "contract_item_movements",
      { tenant_id: tenantId },
      "id,movement_type,reverses_movement_id,contract_item_id",
    );
    const originalConsumption = movementRows.body.find(
      (movement) =>
        movement.movement_type === "consumption" && movement.contract_item_id === contractItemId,
    );
    assert.ok(originalConsumption, "the original consumption must remain in the ledger");
    const duplicateReversal = await callRpc("reverse_contract_item_consumption", {
      p_tenant_id: tenantId,
      p_movement_id: originalConsumption.id,
      p_reason: "Tentativa de estorno duplicado",
    });
    assert.ok(duplicateReversal.status >= 400, "a consumption cannot be reversed twice");
    const crossTenantItems = await readRows(
      "contract_items",
      { tenant_id: "91000000-0000-4000-8000-000000000002" },
      "id",
    );
    assert.equal(crossTenantItems.status, 200);
    assert.equal(crossTenantItems.body.length, 0, "tenant A cannot read tenant B contract items");

    // Invalid extension dates must be rejected without creating an amendment.
    await page
      .getByRole("button", {
        name: `Registrar aditivo — Contrato ${contractNumber}`,
        exact: true,
      })
      .click();
    let amendmentDialog = page
      .getByRole("dialog")
      .filter({ hasText: "Termo aditivo — Contrato " + contractNumber });
    await amendmentDialog.locator("input").nth(0).fill("Aditivo inválido E2E");
    await amendmentDialog.locator("input[type=date]").nth(0).fill(contractRows.body[0].end_date);
    await amendmentDialog.getByRole("button", { name: "Registrar", exact: true }).click();
    await page
      .getByText("A nova data final deve ser posterior à vigência atual do contrato.")
      .waitFor();
    const rejectedAmendments = await readRows(
      "contract_amendments",
      { tenant_id: tenantId, contract_id: contractRows.body[0].id },
      "id",
    );
    assert.equal(rejectedAmendments.body.length, 0);
    await amendmentDialog.getByRole("button", { name: "Cancelar", exact: true }).click();

    // Amendment behavior: each type updates only its intended contract field.
    await page
      .getByRole("button", {
        name: `Registrar aditivo — Contrato ${contractNumber}`,
        exact: true,
      })
      .click();
    amendmentDialog = page
      .getByRole("dialog")
      .filter({ hasText: "Termo aditivo — Contrato " + contractNumber });
    await amendmentDialog.locator("input").nth(0).fill("1º Aditivo E2E");
    await amendmentDialog.locator("input[type=date]").nth(0).fill("2028-11-15");
    await amendmentDialog.locator("input[type=date]").nth(1).fill("2026-11-16");
    await amendmentDialog.getByRole("button", { name: "Registrar", exact: true }).click();
    await amendmentDialog.waitFor({ state: "hidden" });
    await page
      .getByText("Aditivo registrado e contrato atualizado.", { exact: true })
      .first()
      .waitFor();
    let amendmentContract = await readRows(
      "contracts",
      { tenant_id: tenantId, number: contractNumber },
      "id,total_value,end_date",
    );
    assert.equal(amendmentContract.body[0].end_date, "2028-11-15");

    await page
      .getByRole("button", {
        name: `Registrar aditivo — Contrato ${contractNumber}`,
        exact: true,
      })
      .click();
    amendmentDialog = page
      .getByRole("dialog")
      .filter({ hasText: "Termo aditivo — Contrato " + contractNumber });
    await amendmentDialog.locator("input").nth(0).fill("2º Aditivo E2E");
    await amendmentDialog.getByRole("combobox").click();
    await page.getByRole("option", { name: "Acréscimo de valor", exact: true }).click();
    await amendmentDialog.locator("input").nth(1).fill("5");
    await amendmentDialog.locator("input[type=date]").nth(0).fill("2026-11-16");
    await amendmentDialog.getByRole("button", { name: "Registrar", exact: true }).click();
    await amendmentDialog.waitFor({ state: "hidden" });
    await page
      .getByText("Aditivo registrado e contrato atualizado.", { exact: true })
      .first()
      .waitFor();
    amendmentContract = await readRows(
      "contracts",
      { tenant_id: tenantId, number: contractNumber },
      "id,total_value,end_date",
    );
    const secondAmendmentRows = await readRows(
      "contract_amendments",
      { tenant_id: tenantId, contract_id: contractRows.body[0].id, number: "2º Aditivo E2E" },
      "kind,value_change",
    );
    assert.equal(secondAmendmentRows.body.length, 1);
    assert.equal(secondAmendmentRows.body[0].kind, "acrescimo");
    assert.equal(Number(secondAmendmentRows.body[0].value_change), 5);
    assert.equal(amendmentContract.body[0].total_value, 145);

    await page
      .getByRole("button", {
        name: `Registrar aditivo — Contrato ${contractNumber}`,
        exact: true,
      })
      .click();
    amendmentDialog = page
      .getByRole("dialog")
      .filter({ hasText: "Termo aditivo — Contrato " + contractNumber });
    await amendmentDialog.locator("input").nth(0).fill("3º Aditivo inválido E2E");
    await amendmentDialog.getByRole("combobox").click();
    await page.getByRole("option", { name: "Supressão de valor", exact: true }).click();
    await amendmentDialog.locator("input").nth(1).fill("130");
    await amendmentDialog.getByRole("button", { name: "Registrar", exact: true }).click();
    await page
      .getByText(
        /A supressao nao pode reduzir o valor do contrato abaixo da soma dos itens cadastrados/,
      )
      .waitFor();
    amendmentContract = await readRows(
      "contracts",
      { tenant_id: tenantId, number: contractNumber },
      "id,total_value,end_date",
    );
    assert.equal(amendmentContract.body[0].total_value, 145);
    const rejectedSuppression = await readRows(
      "contract_amendments",
      { tenant_id: tenantId, contract_id: contractRows.body[0].id },
      "id",
    );
    assert.equal(rejectedSuppression.body.length, 2);

    await amendmentDialog.locator("input").nth(0).fill("3º Aditivo E2E");
    await amendmentDialog.locator("input").nth(1).fill("3");
    await amendmentDialog.locator("input[type=date]").nth(0).fill("2026-11-16");
    await amendmentDialog.getByRole("button", { name: "Registrar", exact: true }).click();
    await amendmentDialog.waitFor({ state: "hidden" });
    await page
      .getByText("Aditivo registrado e contrato atualizado.", { exact: true })
      .first()
      .waitFor();
    amendmentContract = await readRows(
      "contracts",
      { tenant_id: tenantId, number: contractNumber },
      "id,total_value,end_date",
    );
    assert.equal(amendmentContract.body[0].total_value, 142);

    await page
      .getByRole("button", {
        name: `Registrar aditivo — Contrato ${contractNumber}`,
        exact: true,
      })
      .click();
    amendmentDialog = page
      .getByRole("dialog")
      .filter({ hasText: "Termo aditivo — Contrato " + contractNumber });
    await amendmentDialog.locator("input").nth(0).fill("4º Aditivo E2E");
    await amendmentDialog.getByRole("combobox").click();
    await page.getByRole("option", { name: "Outro", exact: true }).click();
    await amendmentDialog.locator("input[type=date]").nth(0).fill("2026-11-16");
    await amendmentDialog.getByRole("button", { name: "Registrar", exact: true }).click();
    await amendmentDialog.waitFor({ state: "hidden" });
    await page
      .getByText("Aditivo registrado e contrato atualizado.", { exact: true })
      .first()
      .waitFor();
    const amendmentRows = await readRows(
      "contract_amendments",
      { tenant_id: tenantId, contract_id: contractRows.body[0].id },
      "number,kind,value_change,new_end_date,signed_at",
    );
    assert.equal(amendmentRows.status, 200);
    assert.equal(amendmentRows.body.length, 4);
    assert.ok(amendmentRows.body.every((row) => row.signed_at === "2026-11-16"));
    assert.deepEqual(amendmentRows.body.map((row) => row.kind).sort(), [
      "acrescimo",
      "outro",
      "prorrogacao",
      "supressao",
    ]);

    await page.getByRole("button", { name: /Central de aditivos/ }).click();
    await page.getByRole("heading", { name: "Histórico consolidado de aditivos" }).waitFor();
    await page.getByRole("textbox", { name: "Pesquisar aditivos" }).fill("4º Aditivo E2E");
    await page.getByText("4º Aditivo E2E", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Ver contrato e histórico", exact: true }).click();
    await page.getByText("Histórico de aditivos do contrato", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Novo aditivo", exact: true }).click();
    const contractPicker = page
      .getByRole("dialog")
      .filter({ hasText: "Selecionar contrato para novo aditivo" });
    await contractPicker
      .getByRole("textbox", { name: "Buscar contrato para aditivo" })
      .fill(contractNumber);
    await contractPicker.getByRole("button", { name: new RegExp(contractNumber) }).click();
    await amendmentDialog.getByRole("button", { name: "Cancelar", exact: true }).click();
    await amendmentDialog.waitFor({ state: "hidden" });
    console.log(
      "PASS amendment workspace: search, consolidated history and quick contract selection",
    );

    const budgets = await readRows(
      "procurement_budget_allocations",
      { tenant_id: tenantId, process_id: processId },
      "id,fiscal_year,budget_unit,allocated_amount",
    );
    assert.equal(budgets.status, 200);
    assert.equal(budgets.body.length, 1);
    assert.equal(budgets.body[0].budget_unit, "Fundo Municipal de Saúde E2E");

    // Complete the official map only after the contract lifecycle has finished.
    await page.goto(`${appUrl}/processos`, { waitUntil: "domcontentloaded" });
    await processCard.click();
    await detailDialog.getByRole("button", { name: "Itens, preços e orçamento" }).click();
    await composition.getByRole("button", { name: "Mapa comparativo (2)" }).click();
    const mapField = (label) => mapDialog.getByText(label, { exact: true }).locator("..");
    async function chooseMapOption(label, option) {
      await mapField(label).getByRole("combobox").click();
      await page.getByRole("option", { name: option, exact: true }).click();
    }
    await chooseMapOption("Origem dos recursos do processo *", "Recursos próprios do ente");
    await chooseMapOption("Base normativa declarada", "Outro fundamento normativo");
    await chooseMapOption("Aplicabilidade da IN 65/2021", "Não aplicável (exige justificativa)");
    await mapDialog
      .getByPlaceholder(
        "Liste fornecedor, data da consulta, canal e prazo de resposta; se nenhum deixou de responder, declare expressamente.",
      )
      .fill("Cenário sintético de CI: nenhum fornecedor consultado deixou de responder.");
    await mapDialog
      .getByPlaceholder(
        "Registre a origem dos recursos, a norma local aplicável ou a justificativa de não aplicabilidade.",
      )
      .fill("Enquadramento exclusivamente sintético para validar o fluxo em banco descartável.");
    await mapDialog.getByRole("button", { name: "Registrar validação normativa" }).click();
    await page.getByText("Enquadramento normativo registrado para este processo.").waitFor();
    await mapDialog.getByText("Validado", { exact: true }).waitFor();
    const complianceAudit = await readRows(
      "audit_events",
      { tenant_id: tenantId, entity: "procurement_process_compliance", entity_id: processId },
      "action,actor_id,details",
    );
    assert.equal(complianceAudit.status, 200);
    assert.ok(complianceAudit.body.some((event) => event.action === "INSERT"));
    await mapDialog
      .getByPlaceholder("Explique por que o método é adequado à série de preços e ao objeto.")
      .fill("Mediana da série sintética de preços efetivos para comprovar o cálculo.");
    await mapDialog
      .getByPlaceholder(
        "Registre a impossibilidade de obter três preços e a fundamentação para prosseguir.",
      )
      .fill("Duas fontes sintéticas disponíveis exclusivamente neste cenário de CI.");
    await mapDialog.getByRole("button", { name: "Registrar aprovação do preço" }).click();
    await page.getByText(/Preço aprovado:/).waitFor();
    await mapDialog.getByText("Preço estimado aprovado", { exact: true }).waitFor();
    await mapDialog
      .getByRole("button", { name: "Encaminhar mapa para aprovação e assinatura" })
      .click();
    const mapTitle = `Mapa comparativo — ${processNumber}`;
    const mapRow = page.getByRole("row").filter({ hasText: mapTitle });
    await mapRow.waitFor();
    const [draftDownload] = await Promise.all([
      page.waitForEvent("download"),
      mapRow.getByRole("button", { name: "PDF (rascunho)", exact: true }).click(),
    ]);
    const draftPdf = await PDFDocument.load(await readFile(await draftDownload.path()));
    assert.ok(draftPdf.getPages().every((p) => p.getWidth() > p.getHeight()));
    await mapRow.getByRole("button", { name: "Enviar para aprovação", exact: true }).click();
    await mapRow.getByText("Aguardando aprovação", { exact: true }).waitFor();

    const reviewerContext = await browser.newContext();
    try {
      const reviewer = await reviewerContext.newPage();
      await reviewer.addInitScript(
        (id) => localStorage.setItem("gfs:organizacao-id", id),
        tenantId,
      );
      await reviewer.goto(`${appUrl}/entrar?portal=secretaria`, { waitUntil: "networkidle" });
      await reviewer.getByLabel("E-mail").fill("reviewer.secretaria.a@example.invalid");
      await reviewer.locator("#senha").fill(password);
      await Promise.all([
        reviewer.waitForURL(/\/painel(?:[/?#]|$)/),
        reviewer.getByRole("button", { name: "Entrar", exact: true }).click(),
      ]);
      await reviewer.goto(`${appUrl}/documentos`, { waitUntil: "domcontentloaded" });
      await reviewer.getByRole("tab", { name: /Gerados/ }).click();
      const reviewerRow = reviewer.getByRole("row").filter({ hasText: mapTitle });
      await reviewerRow.getByRole("button", { name: "Aprovar", exact: true }).click();
      await reviewerRow.getByText("Aprovado", { exact: true }).waitFor();
      await verifyAnnualDemand({ page, reviewer, appUrl, tenantId, readRows, callRpc });
    } finally {
      await reviewerContext.close();
    }
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("tab", { name: /Gerados/ }).click();
    page.once("dialog", (dialog) => dialog.accept());
    await mapRow.getByRole("button", { name: "Assinar", exact: true }).click();
    const signedDownloadButton = mapRow.getByRole("button", { name: /PDF assinado/ });
    await signedDownloadButton.waitFor();
    const [signedDownload] = await Promise.all([
      page.waitForEvent("download"),
      signedDownloadButton.click(),
    ]);
    const signedBytes = await readFile(await signedDownload.path());
    const signedPdf = await PDFDocument.load(signedBytes);
    assert.equal(signedPdf.getPageCount(), draftPdf.getPageCount() + 1);
    assert.ok(
      signedPdf
        .getPages()
        .slice(0, -1)
        .every((p) => p.getWidth() > p.getHeight()),
    );
    const signedRows = await readRows(
      "generated_documents",
      { tenant_id: tenantId, title: mapTitle },
      "status,signed_pdf_sha256,signed_pdf_size",
    );
    assert.equal(signedRows.status, 200);
    assert.equal(signedRows.body.length, 1);
    assert.equal(signedRows.body[0].status, "signed");
    assert.equal(signedRows.body[0].signed_pdf_size, signedBytes.length);
    assert.equal(
      signedRows.body[0].signed_pdf_sha256,
      createHash("sha256").update(signedBytes).digest("hex"),
    );
    console.log(
      "PASS official price map: approved estimate, normative decision, independent review, landscape PDF and signed artifact integrity",
    );
    console.log(
      "PASS procurement browser workflow: atomic checklist, guarded stage transition, item, freight-inclusive quotes, budget, price reference, linked contract, and tenant isolation",
    );
  } catch (error) {
    await mkdir("artifacts", { recursive: true });
    await page
      .screenshot({ path: "artifacts/procurement-e2e-failure.png", fullPage: true })
      .catch(() => {});
    throw error;
  } finally {
    await context.close();
  }
}

async function verifyDocumentApprovalWorkflow() {
  const documentTitle = "Documento E2E — aprovação por usuário distinto";
  const tenantId = "91000000-0000-4000-8000-000000000001";
  const documentId = "98000000-0000-4000-8000-000000000001";
  const authorId = "90000000-0000-4000-8000-000000000001";
  const reviewerId = "90000000-0000-4000-8000-000000000003";

  async function signInAndOpenGeneratedDocuments(email) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.addInitScript((id) => localStorage.setItem("gfs:organizacao-id", id), tenantId);
    page.setDefaultTimeout(30_000);
    await page.goto(`${appUrl}/entrar?portal=secretaria`, { waitUntil: "networkidle" });
    await page.getByLabel("E-mail").fill(email);
    await page.locator("#senha").fill(password);
    await Promise.all([
      page.waitForURL(/\/painel(?:[/?#]|$)/),
      page.getByRole("button", { name: "Entrar", exact: true }).click(),
    ]);
    await page.goto(`${appUrl}/documentos`, { waitUntil: "domcontentloaded" });
    try {
      await page.getByRole("heading", { name: "Documentos e vencimentos", exact: true }).waitFor();
    } catch (error) {
      console.error(`Document approval page debug (${email}): URL=${page.url()}`);
      console.error((await page.locator("body").innerText()).slice(0, 3000));
      throw error;
    }
    await page.getByRole("tab", { name: /Gerados/ }).click();
    return { context, page };
  }

  const author = await signInAndOpenGeneratedDocuments("e2e.secretaria.a@example.invalid");
  try {
    const row = author.page.getByRole("row").filter({ hasText: documentTitle });
    await row.waitFor();
    await row.getByRole("button", { name: "Enviar para aprovação", exact: true }).click();
    await row.getByText("Aguardando aprovação", { exact: true }).waitFor();

    const authorToken = await readAccessToken(author.page);
    const submittedEvents = await author.page.evaluate(
      async ({ apiUrl, publicKey, token, tenantId, documentId }) => {
        const response = await fetch(
          `${apiUrl}/rest/v1/generated_document_workflow_events?select=actor_id,action,to_status&tenant_id=eq.${tenantId}&document_id=eq.${documentId}`,
          { headers: { apikey: publicKey, Authorization: `Bearer ${token}` } },
        );
        return { status: response.status, events: await response.json() };
      },
      { apiUrl: supabaseUrl, publicKey: anonKey, token: authorToken, tenantId, documentId },
    );
    assert.equal(submittedEvents.status, 200);
    assert.ok(
      submittedEvents.events.some(
        (event) =>
          event.action === "submitted" &&
          event.actor_id === authorId &&
          event.to_status === "pending_approval",
      ),
      "submission history must record the document author's identity",
    );
  } finally {
    await author.context.close();
  }

  const reviewer = await signInAndOpenGeneratedDocuments("reviewer.secretaria.a@example.invalid");
  try {
    assert.equal(
      await reviewer.page.getByRole("button", { name: "Gerar documento", exact: true }).count(),
      0,
      "the reviewer without documents:create must not see the document creation action",
    );
    assert.equal(
      await reviewer.page.getByRole("button", { name: "Registrar documento", exact: true }).count(),
      0,
      "the reviewer without documents:create must not see the supplier-document creation action",
    );

    const attemptedInsert = await reviewer.page.evaluate(
      async ({ apiUrl, publicKey, token, tenantId }) => {
        const response = await fetch(`${apiUrl}/rest/v1/generated_documents`, {
          method: "POST",
          headers: {
            apikey: publicKey,
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            Prefer: "return=representation",
          },
          body: JSON.stringify({
            tenant_id: tenantId,
            title: "Tentativa de criação pelo aprovador E2E",
            content_snapshot: "Este registro não deve ser criado.",
            status: "draft",
          }),
        });
        return { status: response.status, body: await response.text() };
      },
      {
        apiUrl: supabaseUrl,
        publicKey: anonKey,
        token: await readAccessToken(reviewer.page),
        tenantId,
      },
    );
    const deniedInsertRows = attemptedInsert.body.trim().startsWith("[")
      ? JSON.parse(attemptedInsert.body)
      : null;
    assert.ok(
      attemptedInsert.status >= 400 ||
        (Array.isArray(deniedInsertRows) && deniedInsertRows.length === 0),
      `the reviewer must not create a document through the Data API (HTTP ${attemptedInsert.status})`,
    );

    const row = reviewer.page.getByRole("row").filter({ hasText: documentTitle });
    await row.getByText("Aguardando aprovação", { exact: true }).waitFor();
    await row.getByRole("button", { name: "Aprovar", exact: true }).click();
    await row.getByText("Aprovado", { exact: true }).waitFor();

    const reviewerToken = await readAccessToken(reviewer.page);
    const finalEvents = await reviewer.page.evaluate(
      async ({ apiUrl, publicKey, token, tenantId, documentId }) => {
        const response = await fetch(
          `${apiUrl}/rest/v1/generated_document_workflow_events?select=actor_id,action,to_status&tenant_id=eq.${tenantId}&document_id=eq.${documentId}`,
          { headers: { apikey: publicKey, Authorization: `Bearer ${token}` } },
        );
        return { status: response.status, events: await response.json() };
      },
      { apiUrl: supabaseUrl, publicKey: anonKey, token: reviewerToken, tenantId, documentId },
    );
    assert.equal(finalEvents.status, 200);
    assert.ok(
      finalEvents.events.some(
        (event) =>
          event.action === "submitted" &&
          event.actor_id === authorId &&
          event.to_status === "pending_approval",
      ),
      "review history must retain the submitting author's identity",
    );
    assert.ok(
      finalEvents.events.some(
        (event) =>
          event.action === "approved" &&
          event.actor_id === reviewerId &&
          event.to_status === "approved",
      ),
      "review history must record the distinct approver's identity",
    );
    reviewer.page.once("dialog", async (dialog) => dialog.accept());
    await row.getByRole("button", { name: "Cancelar", exact: true }).click();
    await row.getByText("Cancelado", { exact: true }).first().waitFor();
    assert.equal(
      await row.getByText("Cancelado", { exact: true }).count(),
      2,
      "both the document and its approval workflow must show cancelled status",
    );

    const cancellation = await reviewer.page.evaluate(
      async ({ apiUrl, publicKey, token, tenantId, documentId }) => {
        const headers = { apikey: publicKey, Authorization: `Bearer ${token}` };
        const [eventResponse, documentResponse] = await Promise.all([
          fetch(
            `${apiUrl}/rest/v1/generated_document_workflow_events?select=actor_id,action,from_status,to_status&tenant_id=eq.${tenantId}&document_id=eq.${documentId}&action=eq.cancelled`,
            { headers },
          ),
          fetch(
            `${apiUrl}/rest/v1/generated_documents?select=status&tenant_id=eq.${tenantId}&id=eq.${documentId}`,
            { headers },
          ),
        ]);
        return {
          eventStatus: eventResponse.status,
          events: await eventResponse.json(),
          documentStatus: documentResponse.status,
          documents: await documentResponse.json(),
        };
      },
      {
        apiUrl: supabaseUrl,
        publicKey: anonKey,
        token: reviewerToken,
        tenantId,
        documentId,
      },
    );
    assert.equal(cancellation.eventStatus, 200);
    assert.equal(cancellation.documentStatus, 200);
    assert.equal(cancellation.documents[0]?.status, "cancelled");
    assert.ok(
      cancellation.events.some(
        (event) =>
          event.actor_id === reviewerId &&
          event.action === "cancelled" &&
          event.from_status === "approved" &&
          event.to_status === "cancelled",
      ),
      "cancellation must close the approved workflow and record the cancelling actor",
    );
    console.log(
      "PASS document workflow: separate approval, create permission denial, synchronized cancellation, and actor history",
    );
  } finally {
    await reviewer.context.close();
  }
}

try {
  for (const scenario of scenarios) {
    await verifyAuthenticatedTenant(scenario);
  }
  await verifyDocumentApprovalWorkflow();
  await verifyProcurementLifecycle();
  console.log(
    "PASS authenticated multitenant browser E2E: both synthetic tenant accounts are isolated.",
  );
} finally {
  await browser.close();
  if (failedPages.length > 0) {
    console.error(`Failed scenarios: ${failedPages.join(", ")}`);
  }
}
