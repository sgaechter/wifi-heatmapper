import { useSettings } from "@/components/GlobalSettings";
import { PasswordInput } from "./PasswordInput";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { PopoverHelper } from "@/components/PopoverHelpText";
import HeatmapAdvancedConfig from "./HeatmapAdvancedConfig";
import MediaDropdown from "./MediaDropdown";
import { sanitizeFilename } from "@/lib/utils";
import { useRef } from "react";

export default function SettingsEditor() {
  const { settings, updateSettings, readNewSettingsFromFile } = useSettings();
  const importInputRef = useRef<HTMLInputElement>(null);

  /**
   * handleNewImageFile - given the name of a new image file,
   *    get the settings for that floor image
   * @param theFile - name of the new image file
   */
  function handleNewImageFile(theFile: string): void {
    readNewSettingsFromFile(theFile); // tell the parent about the new file
  }

  async function handleExport() {
    try {
      const response = await fetch(
        `/api/export?name=${encodeURIComponent(settings.floorplanImageName)}`,
      );
      if (!response.ok) {
        const contentType = response.headers.get("content-type") || "";
        const body = contentType.includes("application/json")
          ? JSON.stringify(await response.json(), null, 2)
          : await response.text();
        throw new Error(body);
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${settings.floorplanImageName}.wifiheatmap.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert(`Export failed: ${err}`);
    }
  }

  function handleImportClick() {
    importInputRef.current?.click();
  }

  async function handleImportFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/import", {
        method: "POST",
        body: formData,
      });
      if (!response.ok) throw new Error(await response.text());
      const result = await response.json();
      readNewSettingsFromFile(result.floorplanImageName);
      alert(`Imported ${result.floorplanImageName}`);
    } catch (err) {
      alert(`Import failed: ${err}`);
    }
    if (importInputRef.current) importInputRef.current.value = "";
  }

  return (
    <table className="w-full max-w-4xl">
      <tbody>
        <tr>
          <td className="text-right pr-4">
            <Label htmlFor="Files" className="font-bold text-lg">
              Floor plan&nbsp;
              <PopoverHelper text="Choose a file to be used as a background image, or upload another PNG, JPEG, or PDF file. PDFs are converted to an image on the server." />
            </Label>
          </td>
          <td className="max-w-[400px] p-0 m-0">
            <MediaDropdown
              defaultValue={settings.floorplanImageName}
              onChange={(val) => handleNewImageFile(val)}
            />
            {settings.floorplanImageName && (
              <p className="text-xs text-gray-500 mt-1">
                Data: data/surveys/
                {sanitizeFilename(settings.floorplanImageName)}.json
              </p>
            )}
          </td>
        </tr>

        <tr>
          <td className="text-right pr-4">
            <Label htmlFor="iperfServer" className="font-bold text-lg">
              iperfServer&nbsp;
              <PopoverHelper text="Address of an iperf3 server (e.g., 192.168.1.10 or 192.168.1.10:5201). Port 5201 is used by default. Set to 'localhost' to skip iperf tests." />
            </Label>{" "}
          </td>
          <td>
            <input
              type="text"
              placeholder="e.g., 192.168.1.10 or 192.168.1.10:5201"
              className="w-full border border-gray-200 rounded-sm p-2 focus:outline-none focus:ring focus:ring-blue-300 focus:border-blue-400"
              value={settings.iperfServerAdrs}
              onChange={(e) =>
                updateSettings({ iperfServerAdrs: e.target.value.trim() })
              }
            />
          </td>
        </tr>

        <tr>
          <td className="text-right pr-4">
            <Label htmlFor="testDuration" className="font-bold text-lg">
              Test Duration&nbsp;
              <PopoverHelper text="Duration of the speed test (in seconds)." />
            </Label>
          </td>
          <td>
            <input
              type="number"
              className="w-full border border-gray-200 rounded-sm p-2 focus:outline-none focus:ring focus:ring-blue-300 focus:border-blue-400"
              value={settings.testDuration}
              onChange={(e) =>
                updateSettings({ testDuration: Number(e.target.value.trim()) })
              }
            />
          </td>
        </tr>

        <tr>
          <td className="text-right pr-4">
            <Label htmlFor="sudoPassword" className="font-bold text-lg">
              sudo password&nbsp;
              <PopoverHelper text="Enter the sudo password: required on macOS or Linux." />
            </Label>
          </td>
          <td>
            <PasswordInput
              value={settings.sudoerPassword}
              onChange={(e) => updateSettings({ sudoerPassword: e })}
            />
          </td>
        </tr>

        <tr>
          <td colSpan={2} className="text-right">
            <HeatmapAdvancedConfig />
          </td>
        </tr>

        <tr>
          <td colSpan={2} className="text-right pt-4">
            <div className="inline-flex gap-2">
              <Button variant="outline" size="sm" onClick={handleExport}>
                Export survey
              </Button>
              <Button variant="outline" size="sm" onClick={handleImportClick}>
                Import survey
              </Button>
              <input
                type="file"
                accept=".json"
                className="hidden"
                ref={importInputRef}
                onChange={handleImportFileChange}
              />
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  );
}
