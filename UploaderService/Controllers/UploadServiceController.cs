using Autofills.Common;
using Microsoft.AspNetCore.Mvc;

[ApiController]
[Route("[controller]")]
public class UploadServiceController : ControllerBase
{
    [HttpPost]
    public async Task<IActionResult> Post(IFormFile file)
    {
        if(file == null || file.Length == 0)
        {
            return BadRequest("Upload a file.");
        }

        var path = Path.Combine(Directory.GetCurrentDirectory(), "uploads", file.FileName);

        using(var stream = new FileStream(path, FileMode.Create))
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
            string outputPath = @".\\Autofills";

            if(BusWankers.CheckPaths(inputFile, outputPath + "\\dummytext.txt"))
                ExcelFileHelper.SaveAsCsv(inputFile, outputPath);

            BusWankers.GenerateAutofillText($"{outputPath}\\Thursday - Coach.csv", $"{outputPath}\\bw_autofills.txt");
            BusWankers.GenerateAutofillText($"{outputPath}\\Sunday - General.csv", $"{outputPath}\\g_autofills.txt");
        });
    }
} 
