using Autofills.Common;
using Microsoft.AspNetCore.Mvc;

[ApiController]
public class UploadServiceController : ControllerBase
{
    [HttpPost]
    [Route("upload")]
    [RequestSizeLimit(100_000_000)]
    public async Task<IActionResult> Upload(IFormFile file, string username, string password)
    {
        // Check if a file is uploaded
        if (file == null || file.Length == 0)
        {
            return BadRequest("Upload a file.");
        }

        // Check the file type
        if (!file.ContentType.Equals("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", StringComparison.OrdinalIgnoreCase))
        {
            return BadRequest("Only .xlsx files are allowed.");
        }

        // Optional: Check file extension as well
        var extension = Path.GetExtension(file.FileName).ToLowerInvariant();
        if (extension != ".xlsx")
        {
            return BadRequest("Only .xlsx files are allowed.");
        }

        if (username != "AndyBest" || password != "Y0rkshireL4d")
        {
            return Unauthorized();
        }


        var path = Path.Combine(Directory.GetCurrentDirectory(), "Uploaded.xlsx");

        using (var stream = new FileStream(path, FileMode.Create))
        {
            await file.CopyToAsync(stream);
        }

        GenerateAutofills(path);

        return Ok(new { file.FileName, file.Length });
    }

    private async void GenerateAutofills(string inputFile)
    {
        await Task.Run(() =>
        {
            string outputPath = @"./Autofills";

            if (BusWankers.CheckPaths(inputFile, outputPath + "/dummytext.txt"))
                ExcelFileHelper.SaveAsCsv(inputFile, outputPath);

            BusWankers.GenerateAutofillText($"{outputPath}/Thursday-Coach.csv", $"{outputPath}/bw_autofills.txt");
            BusWankers.GenerateAutofillText($"{outputPath}/Sunday-General.csv", $"{outputPath}/g_autofills.txt");

            // File.Delete($"{outputPath}/Thursday-Coach.csv");
            // File.Delete($"{outputPath}/Sunday-General.csv");
            // File.Delete($"{outputPath}/Thestartinglineup.csv");
        });
    }
}
